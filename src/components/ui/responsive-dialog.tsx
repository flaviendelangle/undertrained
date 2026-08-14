import * as React from "react";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "~/components/ui/drawer";
import { useIsMobile } from "~/hooks/useIsMobile";

/**
 * Picks the modal presentation for the current viewport: a centered Dialog on
 * desktop, a swipe-aware bottom-sheet Drawer on mobile. The set mirrors the
 * Dialog API, so migrating a form is a mechanical import swap.
 */
const ResponsiveDialogContext = React.createContext(false);

function ResponsiveDialog(props: DialogPrimitive.Root.Props) {
  const isMobile = useIsMobile();
  return (
    <ResponsiveDialogContext.Provider value={isMobile}>
      {isMobile ? (
        <Drawer {...(props as React.ComponentProps<typeof Drawer>)} />
      ) : (
        <Dialog {...props} />
      )}
    </ResponsiveDialogContext.Provider>
  );
}

function ResponsiveDialogTrigger(
  props: Omit<DialogPrimitive.Trigger.Props, "handle">,
) {
  const isMobile = React.useContext(ResponsiveDialogContext);
  return isMobile ? <DrawerTrigger {...props} /> : <DialogTrigger {...props} />;
}

function ResponsiveDialogContent(
  props: DialogPrimitive.Popup.Props & { showCloseButton?: boolean },
) {
  const isMobile = React.useContext(ResponsiveDialogContext);
  return isMobile ? (
    <DrawerContent {...(props as React.ComponentProps<typeof DrawerContent>)} />
  ) : (
    <DialogContent {...props} />
  );
}

function ResponsiveDialogHeader(props: React.ComponentProps<"div">) {
  const isMobile = React.useContext(ResponsiveDialogContext);
  const Header = isMobile ? DrawerHeader : DialogHeader;
  return <Header {...props} />;
}

function ResponsiveDialogFooter(
  props: React.ComponentProps<"div"> & { showCloseButton?: boolean },
) {
  const isMobile = React.useContext(ResponsiveDialogContext);
  const Footer = isMobile ? DrawerFooter : DialogFooter;
  return <Footer {...props} />;
}

function ResponsiveDialogTitle(props: DialogPrimitive.Title.Props) {
  const isMobile = React.useContext(ResponsiveDialogContext);
  return isMobile ? <DrawerTitle {...props} /> : <DialogTitle {...props} />;
}

function ResponsiveDialogDescription(props: DialogPrimitive.Description.Props) {
  const isMobile = React.useContext(ResponsiveDialogContext);
  return isMobile ? (
    <DrawerDescription {...props} />
  ) : (
    <DialogDescription {...props} />
  );
}

function ResponsiveDialogClose(props: DialogPrimitive.Close.Props) {
  const isMobile = React.useContext(ResponsiveDialogContext);
  return isMobile ? <DrawerClose {...props} /> : <DialogClose {...props} />;
}

export {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
};
