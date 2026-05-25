import * as React from "react";

import { XIcon } from "lucide-react";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

function Drawer({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="drawer" {...props} />;
}

function DrawerTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

function DrawerPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="drawer-portal" {...props} />;
}

function DrawerClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="drawer-close" {...props} />;
}

function DrawerOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="drawer-overlay"
      className={cn(
        "data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs",
        className,
      )}
      {...props}
    />
  );
}

function DrawerContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean;
}) {
  return (
    <DrawerPortal>
      <DrawerOverlay />
      <DialogPrimitive.Popup
        data-slot="drawer-content"
        className={cn(
          "bg-background data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:slide-out-to-bottom data-open:slide-in-from-bottom ring-foreground/10 fixed inset-x-0 bottom-0 z-50 flex max-h-[90svh] flex-col gap-6 overflow-y-auto rounded-t-xl px-6 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-sm ring-1 duration-150 outline-none",
          className,
        )}
        {...props}
      >
        <div className="bg-muted mx-auto h-1.5 w-12 shrink-0 rounded-full" />
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="drawer-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-4 right-4"
                size="icon-sm"
              />
            }
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DrawerPortal>
  );
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  );
}

function DrawerFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn("flex flex-col-reverse gap-2", className)}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DrawerTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="drawer-title"
      className={cn("leading-none font-medium", className)}
      {...props}
    />
  );
}

function DrawerDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="drawer-description"
      className={cn(
        "text-muted-foreground *:[a]:hover:text-foreground text-sm *:[a]:underline *:[a]:underline-offset-3",
        className,
      )}
      {...props}
    />
  );
}

export {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
};
