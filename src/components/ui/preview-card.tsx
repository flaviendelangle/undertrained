import * as React from "react";

import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card";

import { cn } from "~/lib/utils";

function PreviewCard({ ...props }: PreviewCardPrimitive.Root.Props) {
  return <PreviewCardPrimitive.Root data-slot="preview-card" {...props} />;
}

function PreviewCardTrigger({ ...props }: PreviewCardPrimitive.Trigger.Props) {
  return (
    <PreviewCardPrimitive.Trigger
      data-slot="preview-card-trigger"
      {...props}
    />
  );
}

function PreviewCardContent({
  className,
  align = "center",
  alignOffset = 0,
  side = "top",
  sideOffset = 8,
  children,
  ...props
}: PreviewCardPrimitive.Popup.Props &
  Pick<
    PreviewCardPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <PreviewCardPrimitive.Portal>
      <PreviewCardPrimitive.Positioner
        data-slot="preview-card-positioner"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        // Pin the positioner to the popup's width. With a Viewport, Base UI's
        // auto-resize anchors the popup `position: absolute` for top/left sides
        // so it grows from the anchored edge — which takes it out of the
        // positioner's flow, collapsing the positioner's measured width to 0.
        // Floating UI measures the positioner, so a 0 width makes it think the
        // card always fits and it never flips/shifts: a card on a trigger near
        // the right edge (e.g. the week view's last day) then overflows the
        // viewport and adds a horizontal page scrollbar. `--positioner-width` is
        // the popup width Base UI measures (so this tracks both the default
        // `w-64` and callers that widen the popup); the fallback covers the
        // first frame before it's set.
        //
        // `data-anchor-hidden` covers the detached-trigger + virtualization
        // case: when the active trigger unmounts while the card is open, Base
        // UI leaves a stale reference to the detached node and the popup gets
        // repositioned to (0,0). The `hide` middleware sets this attribute when
        // the rect collapses, so hiding the positioner here keeps the card
        // from flashing into the top-left of the page.
        className="isolate z-60 w-[var(--positioner-width,16rem)] data-anchor-hidden:invisible data-anchor-hidden:pointer-events-none"
      >
        <PreviewCardPrimitive.Popup
          data-slot="preview-card-content"
          className={cn(
            "bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/10 data-[side=inline-start]:slide-in-from-right-2 data-[side=inline-end]:slide-in-from-left-2 z-60 flex w-64 origin-(--transform-origin) flex-col overflow-hidden rounded-md p-0 text-sm shadow-md ring-1 outline-hidden duration-100",
            className,
          )}
          {...props}
        >
          {/*
           * The Journal shares one popup across many detached triggers (one per
           * activity chip / week summary). The Viewport cross-fades and slides
           * the content as the active trigger changes, while the popup resizes
           * and the positioner glides to the new anchor. See globals.css for the
           * transition rules keyed off this slot.
           */}
          <PreviewCardPrimitive.Viewport
            data-slot="preview-card-viewport"
            className="relative w-full overflow-clip"
          >
            {children}
          </PreviewCardPrimitive.Viewport>
        </PreviewCardPrimitive.Popup>
        <PreviewCardPrimitive.Arrow className="z-60 flex data-[side=bottom]:-top-2.5 data-[side=bottom]:rotate-0 data-[side=inline-end]:-left-3.5 data-[side=inline-end]:-rotate-90 data-[side=inline-start]:-right-3.5 data-[side=inline-start]:rotate-90 data-[side=left]:-right-3.5 data-[side=left]:rotate-90 data-[side=right]:-left-3.5 data-[side=right]:-rotate-90 data-[side=top]:-bottom-2.5 data-[side=top]:rotate-180">
          <ArrowSvg />
        </PreviewCardPrimitive.Arrow>
      </PreviewCardPrimitive.Positioner>
    </PreviewCardPrimitive.Portal>
  );
}

/**
 * Layered arrow (from the Base UI Preview Card demo): the back/front paths are
 * filled with the popup background, the middle path draws the thin border so it
 * matches the popup's `ring-foreground/10` edge.
 */
function ArrowSvg(props: React.ComponentProps<"svg">) {
  return (
    <svg width="20" height="10" viewBox="0 0 20 10" fill="none" {...props}>
      <path
        d="M9.66437 2.60207L4.80758 6.97318C4.07308 7.63423 3.11989 8 2.13172 8H0V10H20V8H18.5349C17.5468 8 16.5936 7.63423 15.8591 6.97318L11.0023 2.60207C10.622 2.2598 10.0447 2.25979 9.66437 2.60207Z"
        className="fill-popover"
      />
      <path
        d="M10.3333 3.34539L5.47654 7.71648C4.55842 8.54279 3.36693 9 2.13172 9H0V8H2.13172C3.11989 8 4.07308 7.63423 4.80758 6.97318L9.66437 2.60207C10.0447 2.25979 10.622 2.2598 11.0023 2.60207L15.8591 6.97318C16.5936 7.63423 17.5468 8 18.5349 8H20V9H18.5349C17.2997 9 16.1082 8.54278 15.1901 7.71648L10.3333 3.34539Z"
        className="fill-foreground/10"
      />
      <path
        d="M8.99975 1.92139L4.14296 6.2925C3.50211 6.87929 2.66461 7.20003 1.79917 7.20003H0V8H2.13172C3.11989 8 4.07308 7.63423 4.80758 6.97318L9.66437 2.60207C10.0447 2.25979 10.622 2.2598 11.0023 2.60207L15.8591 6.97318C16.5936 7.63423 17.5468 8 18.5349 8H20V7.20003H18.2008C17.3354 7.20003 16.4979 6.87929 15.857 6.2925L11.0002 1.92139C10.4737 1.44749 9.52628 1.44748 8.99975 1.92139Z"
        className="fill-popover"
      />
    </svg>
  );
}

export { PreviewCard, PreviewCardContent, PreviewCardTrigger };
