//! Serialized FTMS control. No command is successful until its indication arrives.
use crate::ble::Event;
use std::future::Future;
use tokio::sync::{mpsc, watch};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Request {
    pub request: u64,
    pub watts: Option<u16>,
}
#[derive(Debug, PartialEq)]
pub enum Failure {
    Rejected(u8),
    Link(String),
}
impl std::fmt::Display for Failure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Rejected(code) => write!(f, "Trainer rejected the command (FTMS result {code})"),
            Self::Link(s) => f.write_str(s),
        }
    }
}
pub trait Transport: Send {
    fn available(&self) -> bool {
        true
    }
    fn disconnect(&mut self) -> impl Future<Output = ()> + Send;
    fn request(&mut self, bytes: Vec<u8>) -> impl Future<Output = Result<(), Failure>> + Send;
}
#[derive(Clone, Copy, Debug)]
pub struct PowerRange {
    min: i16,
    max: i16,
    increment: u16,
}
impl PowerRange {
    pub fn parse(bytes: &[u8]) -> Option<Self> {
        if bytes.len() != 6 {
            return None;
        }
        let range = Self {
            min: i16::from_le_bytes(bytes[0..2].try_into().ok()?),
            max: i16::from_le_bytes(bytes[2..4].try_into().ok()?),
            increment: u16::from_le_bytes(bytes[4..6].try_into().ok()?),
        };
        (range.min <= range.max && range.max >= 0 && range.increment > 0).then_some(range)
    }
    fn supports(self, watts: u16) -> bool {
        watts <= 1000
            && i32::from(watts) >= i32::from(self.min)
            && i32::from(watts) <= i32::from(self.max)
            && (i32::from(watts) - i32::from(self.min)) % i32::from(self.increment) == 0
    }
}
pub fn response(bytes: &[u8], opcode: u8) -> Option<Result<(), Failure>> {
    if bytes.len() < 3 || bytes[0] != 0x80 || bytes[1] != opcode {
        return None;
    }
    Some(if bytes[2] == 1 {
        Ok(())
    } else {
        Err(Failure::Rejected(bytes[2]))
    })
}
/// Bound the entire GATT write + indication, not only the write operation.
pub async fn exchange(
    write: impl Future<Output = Result<(), String>>,
    responses: &mut mpsc::UnboundedReceiver<Vec<u8>>,
    opcode: u8,
    deadline: std::time::Duration,
) -> Result<(), Failure> {
    while responses.try_recv().is_ok() {}
    tokio::time::timeout(deadline, async {
        write.await.map_err(Failure::Link)?;
        while let Some(bytes) = responses.recv().await {
            if bytes == [0xff] {
                if opcode == 1 {
                    continue;
                } // Reset may itself relinquish permission; still require its ACK.
                return Err(Failure::Rejected(5));
            }
            if let Some(result) = response(&bytes, opcode) {
                return result;
            }
        }
        Err(Failure::Link("Trainer notification stream ended".into()))
    })
    .await
    .unwrap_or_else(|_| {
        Err(Failure::Link(
            "Trainer did not acknowledge the command. Reconnect it before enabling ERG.".into(),
        ))
    })
}

fn report(
    events: &mpsc::UnboundedSender<Event>,
    req: Request,
    result: Result<Option<u16>, String>,
) {
    let _ = events.send(Event::Erg {
        request: req.request,
        result,
    });
}
fn superseded(desired: &watch::Receiver<Option<Request>>, req: Request) -> bool {
    desired.has_changed().unwrap_or(true) || *desired.borrow() != Some(req)
}
/// Coalesce changing ramp targets rather than queueing seconds of obsolete resistance.
/// After a failure a release is required before any explicit new enable can take effect.
pub async fn run<T: Transport>(
    mut io: T,
    range: PowerRange,
    mut desired: watch::Receiver<Option<Request>>,
    mut lost: watch::Receiver<u64>,
    events: mpsc::UnboundedSender<Event>,
) {
    let mut held = false;
    let mut started = false;
    let mut fault = false;
    loop {
        tokio::select! {
            changed=desired.changed()=>if changed.is_err(){break;},
            changed=lost.changed()=> {
                if changed.is_err() {break;}
                if !held {continue;} // No permission was expected while released.
                held=false;started=false;fault=true;
                let req=*desired.borrow();
                if let Some(req)=req {report(&events,req,Err("Trainer control permission was lost. Enable ERG again when ready.".into()));}
                continue;
            }
        }
        let Some(req) = *desired.borrow_and_update() else {
            continue;
        };
        if req.watts.is_none() {
            let result = if !io.available() {
                Err("Trainer release could not be confirmed. Reconnect the trainer before enabling ERG.".into())
            } else if held {
                io.request(vec![1]).await.map_err(|e| e.to_string())
            } else {
                Ok(())
            };
            if result.is_err() {
                io.disconnect().await;
            }
            held = false;
            started = false;
            fault = false;
            report(&events, req, result.map(|()| None));
            continue;
        }
        if lost.has_changed().unwrap_or(true) {
            lost.borrow_and_update();
            if held {
                held = false;
                started = false;
                fault = true;
            }
        }
        let watts = req.watts.unwrap();
        let result = async {
            if fault {
                return Err(Failure::Link(
                    "ERG stopped after a control failure. Disable it before enabling it again."
                        .into(),
                ));
            }
            if !range.supports(watts) {
                return Err(Failure::Link(format!(
                    "Target {watts} W is outside this trainer's supported range or increment"
                )));
            }
            if !held {
                io.request(vec![0]).await?;
                held = true;
                if superseded(&desired, req) {
                    return Ok(false);
                }
            }
            if !started {
                if superseded(&desired, req) {
                    return Ok(false);
                }
                match io.request(vec![7]).await {
                    // Only an explicitly unsupported Start is tolerable, never a timeout.
                    Err(Failure::Rejected(2)) | Ok(()) => {}
                    Err(e) => return Err(e),
                }
                started = true;
            }
            if superseded(&desired, req) {
                return Ok(false);
            }
            if lost.has_changed().unwrap_or(true) {
                return Err(Failure::Rejected(5));
            }
            let [lo, hi] = watts.to_le_bytes();
            io.request(vec![5, lo, hi]).await?;
            Ok(true)
        }
        .await;
        match result {
            Ok(true) => report(&events, req, Ok(Some(watts))),
            Ok(false) => {}
            Err(error) => {
                fault = true;
                if held {
                    // Best effort only; a timeout poisons the transport and disconnects it.
                    if io.request(vec![1]).await.is_err() {
                        io.disconnect().await;
                    }
                }
                held = false;
                started = false;
                report(&events, req, Err(error.to_string()));
            }
        }
    }
    if held && io.request(vec![1]).await.is_err() {
        io.disconnect().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    type Exchange = (Vec<u8>, tokio::sync::oneshot::Sender<Result<(), Failure>>);
    struct Mock {
        tx: mpsc::UnboundedSender<Exchange>,
    }
    impl Transport for Mock {
        async fn disconnect(&mut self) {}
        async fn request(&mut self, bytes: Vec<u8>) -> Result<(), Failure> {
            let (tx, rx) = tokio::sync::oneshot::channel();
            self.tx.send((bytes, tx)).unwrap();
            rx.await.unwrap()
        }
    }
    #[tokio::test]
    async fn changed_target_during_control_grant_must_still_start() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let (desired, d) = watch::channel(None);
        let (_loss, l) = watch::channel(0);
        let (events, mut ev) = mpsc::unbounded_channel();
        let task = tokio::spawn(run(
            Mock { tx },
            PowerRange::parse(&[0, 0, 0xe8, 3, 1, 0]).unwrap(),
            d,
            l,
            events,
        ));
        desired
            .send(Some(Request {
                request: 1,
                watts: Some(200),
            }))
            .unwrap();
        let (cmd, ack) = rx.recv().await.unwrap();
        assert_eq!(cmd, vec![0]);
        desired
            .send(Some(Request {
                request: 2,
                watts: Some(205),
            }))
            .unwrap();
        ack.send(Ok(())).unwrap();
        let (cmd, ack) = rx.recv().await.unwrap();
        assert_eq!(cmd, vec![7], "coalescing target skipped Start/Resume");
        ack.send(Ok(())).unwrap();
        let (cmd, ack) = rx.recv().await.unwrap();
        assert_eq!(
            cmd,
            vec![5, 205, 0],
            "Only the replacement target is applied"
        );
        ack.send(Ok(())).unwrap();
        assert!(matches!(
            ev.recv().await,
            Some(Event::Erg {
                request: 2,
                result: Ok(Some(205))
            })
        ));
        drop(desired);
        let (cmd, ack) = rx.recv().await.unwrap();
        assert_eq!(cmd, vec![1]);
        ack.send(Ok(())).unwrap();
        task.await.unwrap();
    }

    #[tokio::test]
    async fn successful_write_needs_matching_indication_and_timeout_is_bounded() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let send = async {
            tx.send(vec![0x80, 7, 1]).unwrap();
            tx.send(vec![0x80, 5, 1]).unwrap();
            Ok(())
        };
        assert_eq!(
            exchange(send, &mut rx, 5, std::time::Duration::from_millis(50)).await,
            Ok(())
        );
        // A GATT success with no control-point reply is not trainer acceptance.
        assert!(matches!(
            exchange(
                async { Ok(()) },
                &mut rx,
                5,
                std::time::Duration::from_millis(10)
            )
            .await,
            Err(Failure::Link(_))
        ));
        let lost = async {
            tx.send(vec![0xff]).unwrap();
            Ok(())
        };
        assert_eq!(
            exchange(lost, &mut rx, 5, std::time::Duration::from_millis(50)).await,
            Err(Failure::Rejected(5))
        );
    }

    #[tokio::test]
    async fn permission_lost_after_ack_disables_control_until_explicit_release() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let (desired, d) = watch::channel(None);
        let (loss, l) = watch::channel(0);
        let (events, mut ev) = mpsc::unbounded_channel();
        let task = tokio::spawn(run(
            Mock { tx },
            PowerRange::parse(&[0, 0, 0xe8, 3, 1, 0]).unwrap(),
            d,
            l,
            events,
        ));
        desired
            .send(Some(Request {
                request: 1,
                watts: Some(200),
            }))
            .unwrap();
        for expected in [vec![0], vec![7], vec![5, 200, 0]] {
            let (p, ack) = rx.recv().await.unwrap();
            assert_eq!(p, expected);
            ack.send(Ok(())).unwrap();
        }
        assert!(matches!(
            ev.recv().await,
            Some(Event::Erg {
                request: 1,
                result: Ok(Some(200))
            })
        ));
        loss.send(1).unwrap();
        assert!(matches!(
            ev.recv().await,
            Some(Event::Erg {
                request: 1,
                result: Err(_)
            })
        ));
        desired
            .send(Some(Request {
                request: 2,
                watts: Some(205),
            }))
            .unwrap();
        assert!(matches!(
            ev.recv().await,
            Some(Event::Erg {
                request: 2,
                result: Err(_)
            })
        ));
        assert!(rx.try_recv().is_err());
        desired
            .send(Some(Request {
                request: 3,
                watts: None,
            }))
            .unwrap();
        assert!(matches!(
            ev.recv().await,
            Some(Event::Erg {
                request: 3,
                result: Ok(None)
            })
        ));
        drop(desired);
        task.await.unwrap();
    }

    #[tokio::test]
    async fn a_poisoned_connection_never_confirms_release() {
        struct Poisoned;
        impl Transport for Poisoned {
            fn available(&self) -> bool {
                false
            }
            async fn disconnect(&mut self) {}
            async fn request(&mut self, _: Vec<u8>) -> Result<(), Failure> {
                panic!("unavailable link must not be written")
            }
        }
        let (desired, d) = watch::channel(None);
        let (_loss, l) = watch::channel(0);
        let (events, mut ev) = mpsc::unbounded_channel();
        let task = tokio::spawn(run(
            Poisoned,
            PowerRange::parse(&[0, 0, 0xe8, 3, 1, 0]).unwrap(),
            d,
            l,
            events,
        ));
        desired
            .send(Some(Request {
                request: 1,
                watts: None,
            }))
            .unwrap();
        assert!(matches!(
            ev.recv().await,
            Some(Event::Erg {
                request: 1,
                result: Err(_)
            })
        ));
        drop(desired);
        task.await.unwrap();
    }

    #[test]
    fn range_and_ack_validation() {
        let r = PowerRange::parse(&[0, 0, 0xe8, 3, 5, 0]).unwrap();
        assert!(r.supports(0));
        assert!(r.supports(1000));
        assert!(!r.supports(1001));
        assert!(!r.supports(123));
        assert!(PowerRange::parse(&[0; 6]).is_none());
        assert!(response(&[0x80, 5], 5).is_none());
        assert!(response(&[0x80, 7, 1], 5).is_none());
        assert_eq!(response(&[0x80, 5, 1], 5), Some(Ok(())));
        assert_eq!(response(&[0x80, 5, 5], 5), Some(Err(Failure::Rejected(5))));
    }
    #[tokio::test]
    async fn ack_order_coalescing_and_release() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let (desired, d) = watch::channel(None);
        let (loss, l) = watch::channel(0);
        let (events, mut ev) = mpsc::unbounded_channel();
        let task = tokio::spawn(run(
            Mock { tx },
            PowerRange::parse(&[0, 0, 0xe8, 3, 1, 0]).unwrap(),
            d,
            l,
            events,
        ));
        desired
            .send(Some(Request {
                request: 1,
                watts: Some(200),
            }))
            .unwrap();
        let (p, ack) = rx.recv().await.unwrap();
        assert_eq!(p, vec![0]);
        assert!(ev.try_recv().is_err());
        // A pause during Request Control must never send the old target afterwards.
        desired
            .send(Some(Request {
                request: 2,
                watts: None,
            }))
            .unwrap();
        ack.send(Ok(())).unwrap();
        let (p, ack) = rx.recv().await.unwrap();
        assert_eq!(p, vec![1]);
        ack.send(Ok(())).unwrap();
        assert!(matches!(
            ev.recv().await,
            Some(Event::Erg {
                request: 2,
                result: Ok(None)
            })
        ));
        loss.send(1).unwrap(); // Permission loss while already released must not prevent a fresh grant.
        desired
            .send(Some(Request {
                request: 3,
                watts: Some(250),
            }))
            .unwrap();
        for expected in [vec![0], vec![7], vec![5, 250, 0]] {
            let (p, ack) = rx.recv().await.unwrap();
            assert_eq!(p, expected);
            ack.send(Ok(())).unwrap();
        }
        assert!(matches!(
            ev.recv().await,
            Some(Event::Erg {
                request: 3,
                result: Ok(Some(250))
            })
        ));
        drop(desired);
        let (p, ack) = rx.recv().await.unwrap();
        assert_eq!(p, vec![1]);
        ack.send(Ok(())).unwrap();
        task.await.unwrap();
    }
    #[tokio::test]
    async fn rejected_control_does_not_send_power_or_retry() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let (desired, d) = watch::channel(None);
        let (_loss, l) = watch::channel(0);
        let (events, mut ev) = mpsc::unbounded_channel();
        let task = tokio::spawn(run(
            Mock { tx },
            PowerRange::parse(&[0, 0, 0xe8, 3, 1, 0]).unwrap(),
            d,
            l,
            events,
        ));
        desired
            .send(Some(Request {
                request: 1,
                watts: Some(200),
            }))
            .unwrap();
        let (p, ack) = rx.recv().await.unwrap();
        assert_eq!(p, vec![0]);
        ack.send(Err(Failure::Rejected(5))).unwrap();
        assert!(matches!(
            ev.recv().await,
            Some(Event::Erg { result: Err(_), .. })
        ));
        desired
            .send(Some(Request {
                request: 2,
                watts: Some(205),
            }))
            .unwrap();
        assert!(matches!(
            ev.recv().await,
            Some(Event::Erg {
                request: 2,
                result: Err(_)
            })
        ));
        assert!(rx.try_recv().is_err());
        drop(desired);
        task.await.unwrap();
    }
}
