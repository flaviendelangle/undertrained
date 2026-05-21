import { useTimeout } from "@base-ui/utils/useTimeout";
import { useState } from "react";

import { useAthleteId } from "~/hooks/useAthleteId";
import type { SessionDataPoint, SessionSummary } from "~/sensors/types";
import { downloadFitFile, generateFitFile } from "~/utils/fitFileGenerator";
import { trpc } from "~/utils/trpc";

/** Maximum number of polling attempts when waiting for Strava to process the upload. */
const MAX_UPLOAD_POLL_ATTEMPTS = 30;
/** Interval between upload status checks (ms). */
const UPLOAD_POLL_INTERVAL_MS = 2_000;

interface ExportPanelProps {
  dataPoints: SessionDataPoint[];
  summary: SessionSummary;
  activityName?: string;
}

export function ExportPanel(props: ExportPanelProps) {
  const { dataPoints, summary, activityName } = props;
  const athleteId = useAthleteId();
  const uploadAction = trpc.upload.uploadToStrava.useMutation();
  const checkStatusAction = trpc.upload.checkUploadStatus.useMutation();

  const [uploadState, setUploadState] = useState<
    "idle" | "uploading" | "processing" | "success" | "error"
  >("idle");
  const [activityId, setActivityId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Cancels the pending poll delay if the component unmounts mid-upload.
  const pollTimeout = useTimeout();

  const handleDownloadFit = () => {
    const buffer = generateFitFile(dataPoints, summary);
    downloadFitFile(buffer);
  };

  const handleUploadToStrava = async () => {
    if (!athleteId) return;

    setUploadState("uploading");
    setErrorMsg(null);

    try {
      const buffer = generateFitFile(dataPoints, summary);
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (const byte of bytes) {
        binary += String.fromCharCode(byte);
      }
      const base64 = btoa(binary);

      const name =
        activityName ||
        `Indoor Training ${summary.startTime.toLocaleDateString()}`;

      const result = await uploadAction.mutateAsync({
        athleteId,
        fitFileBase64: base64,
        name,
      });

      setUploadState("processing");

      // Poll for completion
      const uploadId = result.uploadId;
      let attempts = 0;
      while (attempts < MAX_UPLOAD_POLL_ATTEMPTS) {
        await new Promise<void>((resolve) =>
          pollTimeout.start(UPLOAD_POLL_INTERVAL_MS, resolve),
        );
        const status = await checkStatusAction.mutateAsync({
          athleteId,
          uploadId,
        });

        if (status.activityId) {
          setActivityId(status.activityId);
          setUploadState("success");
          return;
        }
        if (status.error) {
          setErrorMsg(status.error);
          setUploadState("error");
          return;
        }
        attempts++;
      }

      setErrorMsg("Upload is taking longer than expected. Check Strava.");
      setUploadState("error");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Upload failed");
      setUploadState("error");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={handleDownloadFit}
        className="bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-md px-4 py-2 text-sm font-medium"
      >
        Download FIT
      </button>

      <button
        onClick={handleUploadToStrava}
        disabled={
          uploadState === "uploading" ||
          uploadState === "processing" ||
          !athleteId
        }
        className="rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-500 disabled:opacity-50"
      >
        {uploadState === "uploading"
          ? "Uploading..."
          : uploadState === "processing"
            ? "Processing..."
            : "Upload to Strava"}
      </button>

      {uploadState === "success" && activityId && (
        <a
          href={`https://www.strava.com/activities/${activityId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-orange-400 underline"
        >
          View on Strava
        </a>
      )}

      {uploadState === "error" && errorMsg && (
        <span className="text-sm text-red-400">{errorMsg}</span>
      )}
    </div>
  );
}
