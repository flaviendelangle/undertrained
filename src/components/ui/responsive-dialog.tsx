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
 * desktop, a bottom-sheet Drawer on mobile. Both are built on the same base-ui
 * `Dialog.Root`, so open state, focus-trap and Escape behave identically — only
 * the popup styling differs. The set mirrors the Dialog API, so migrating a form
 * is a mechanical import swap.
 */
const ResponsiveDialogContext = React.createContext(false);

function ResponsiveDialog(props: DialogPrimitive.Root.Props) {
  const isMobile = useIsMobile();
  const Root = isMobile ? Drawer : Dialog;
  return (
    <ResponsiveDialogContext.Provider value={isMobile}>
      <Root {...props} />
    </ResponsiveDialogContext.Provider>
  );
}

function ResponsiveDialogTrigger(props: DialogPrimitive.Trigger.Props) {
  const isMobile = React.useContext(ResponsiveDialogContext);
  const Trigger = isMobile ? DrawerTrigger : DialogTrigger;
  return <Trigger {...props} />;
}

function ResponsiveDialogContent(
  props: DialogPrimitive.Popup.Props & { showCloseButton?: boolean },
) {
  const isMobile = React.useContext(ResponsiveDialogContext);
  const Content = isMobile ? DrawerContent : DialogContent;
  return <Content {...props} />;
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
  const Title = isMobile ? DrawerTitle : DialogTitle;
  return <Title {...props} />;
}

function ResponsiveDialogDescription(props: DialogPrimitive.Description.Props) {
  const isMobile = React.useContext(ResponsiveDialogContext);
  const Description = isMobile ? DrawerDescription : DialogDescription;
  return <Description {...props} />;
}

function ResponsiveDialogClose(props: DialogPrimitive.Close.Props) {
  const isMobile = React.useContext(ResponsiveDialogContext);
  const Close = isMobile ? DrawerClose : DialogClose;
  return <Close {...props} />;
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
