import { cn } from "~/lib/utils";
import { getSportConfig } from "~/utils/sportConfig";

/**
 * The sport's icon in its color on a faint tile of that color. On an activity
 * row it is the only colored mark: the list reads by sport at a glance while
 * the rows themselves stay neutral.
 */
export function SportIconTile(props: {
  type: string;
  /** Names the sport for assistive tech and on hover; decorative without it. */
  label?: string;
  className?: string;
  iconClassName?: string;
}) {
  const sport = getSportConfig(props.type);
  const Icon = sport.icon;
  return (
    <span
      {...(props.label != null
        ? { role: "img", "aria-label": props.label, title: props.label }
        : { "aria-hidden": true })}
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        props.className,
      )}
      style={{
        color: sport.color,
        backgroundColor: `color-mix(in oklab, ${sport.color} 14%, transparent)`,
      }}
    >
      <Icon className={props.iconClassName} />
    </span>
  );
}
