import * as React from "react";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "~/components/ui/drawer";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "~/components/ui/popover";
import { useIsMobile } from "~/hooks/useIsMobile";

/**
 * Picks the disclosure surface for the current viewport: an anchored Popover on
 * desktop, a bottom-sheet Drawer on mobile. Both share open state, focus-trap
 * and Escape behaviour — only the presentation differs. The set mirrors the
 * Popover API (positioning props are accepted but ignored on mobile), so
 * migrating a popover is a mechanical import swap.
 */
const ResponsivePopoverContext = React.createContext(false);

function ResponsivePopover(props: PopoverPrimitive.Root.Props) {
  const isMobile = useIsMobile();
  return (
    <ResponsivePopoverContext.Provider value={isMobile}>
      {isMobile ? (
        <Drawer {...(props as React.ComponentProps<typeof Drawer>)} />
      ) : (
        <Popover {...props} />
      )}
    </ResponsivePopoverContext.Provider>
  );
}

function ResponsivePopoverTrigger(props: PopoverPrimitive.Trigger.Props) {
  const isMobile = React.useContext(ResponsivePopoverContext);
  return isMobile ? (
    <DrawerTrigger {...(props as React.ComponentProps<typeof DrawerTrigger>)} />
  ) : (
    <PopoverTrigger {...props} />
  );
}

function ResponsivePopoverContent({
  align,
  alignOffset,
  side,
  sideOffset,
  showCloseButton,
  ...props
}: React.ComponentProps<typeof PopoverContent> & {
  showCloseButton?: boolean;
}) {
  const isMobile = React.useContext(ResponsivePopoverContext);
  if (isMobile) {
    // Drawer is a bottom sheet — popover positioning props don't apply.
    return (
      <DrawerContent
        showCloseButton={showCloseButton}
        {...(props as React.ComponentProps<typeof DrawerContent>)}
      />
    );
  }
  return (
    <PopoverContent
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      {...props}
    />
  );
}

function ResponsivePopoverHeader(props: React.ComponentProps<"div">) {
  const isMobile = React.useContext(ResponsivePopoverContext);
  const Header = isMobile ? DrawerHeader : PopoverHeader;
  return <Header {...props} />;
}

function ResponsivePopoverTitle(props: PopoverPrimitive.Title.Props) {
  const isMobile = React.useContext(ResponsivePopoverContext);
  return isMobile ? <DrawerTitle {...props} /> : <PopoverTitle {...props} />;
}

function ResponsivePopoverDescription(props: PopoverPrimitive.Description.Props) {
  const isMobile = React.useContext(ResponsivePopoverContext);
  return isMobile ? (
    <DrawerDescription {...props} />
  ) : (
    <PopoverDescription {...props} />
  );
}

export {
  ResponsivePopover,
  ResponsivePopoverContent,
  ResponsivePopoverDescription,
  ResponsivePopoverHeader,
  ResponsivePopoverTitle,
  ResponsivePopoverTrigger,
};
