import { flattenWorkout, resolvedSegmentCount } from "./flatten";
import { structuredWorkoutSchema } from "./schema";
import { type StructuredWorkout, hasPowerTarget } from "./types";

export type ZwoExportIssue =
  | "exportInvalid"
  | "exportBikeOnly"
  | "exportTestUnsupported"
  | "exportBlockLimit"
  | "exportFtpRequired";

export function getZwoExportIssue(
  structure: StructuredWorkout,
  ftp: number | null,
): ZwoExportIssue | null {
  if (!structuredWorkoutSchema.safeParse(structure).success)
    return "exportInvalid";
  if (structure.sport !== "bike") return "exportBikeOnly";
  // These tests rely on Undertrained's exhaustion detection and FTP estimator.
  if (structure.ftpTest) return "exportTestUnsupported";
  if (resolvedSegmentCount(structure) > 250) return "exportBlockLimit";
  if (
    hasPowerTarget(structure.nodes, ["watts"]) &&
    (ftp == null || !Number.isFinite(ftp) || ftp <= 0)
  )
    return "exportFtpRequired";
  return null;
}

/** XML 1.0 text, also safe inside a double-quoted attribute. */
function xml(value: string): string {
  const valid = Array.from(value)
    .filter((char) => {
      const point = char.codePointAt(0)!;
      return (
        point === 9 ||
        point === 10 ||
        point === 13 ||
        (point >= 0x20 && point <= 0xd7ff) ||
        (point >= 0xe000 && point <= 0xfffd) ||
        point >= 0x10000
      );
    })
    .join("");
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
    "\n": "&#10;",
    "\r": "&#13;",
    "\t": "&#9;",
  };
  return valid.replace(/[&<>"'\n\r\t]/g, (char) => entities[char]);
}

/**
 * Zwift cycling XML. Repeats are expanded in order; powers are fractions of FTP.
 * Fixed watts use the supplied reference FTP, which must also be used in Zwift.
 * Tag shapes follow GoldenCheetah's ZWO writer and workout fixtures:
 * https://github.com/GoldenCheetah/GoldenCheetah/blob/master/src/Train/ErgFile.cpp
 */
export function generateZwo({
  name,
  description,
  structure,
  ftp,
}: {
  name: string;
  description?: string | null;
  structure: StructuredWorkout;
  ftp: number | null;
}): string {
  const issue = getZwoExportIssue(structure, ftp);
  if (issue) throw new Error(issue);
  const blocks = flattenWorkout(structure, ftp ?? 200).map((segment) => {
    let tag: string;
    let power: string;
    const number = (value: number) => Number(value.toFixed(6));
    if (segment.startPct == null || segment.endPct == null) {
      tag = "FreeRide";
      power = "";
    } else if (!segment.isRamp) {
      tag = "SteadyState";
      power = ` Power="${number(segment.startPct)}"`;
    } else {
      tag = segment.startPct < segment.endPct ? "Warmup" : "Cooldown";
      power = ` PowerLow="${number(segment.startPct)}" PowerHigh="${number(segment.endPct)}"`;
    }
    const cadence =
      segment.cadence == null ? "" : ` Cadence="${segment.cadence}"`;
    const attributes = `Duration="${segment.durationSeconds}"${power}${cadence}`;
    return segment.note
      ? `    <${tag} ${attributes}>\n      <textevent timeoffset="0" message="${xml(segment.note)}"/>\n    </${tag}>`
      : `    <${tag} ${attributes}/>`;
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<workout_file>",
    "  <author>Undertrained</author>",
    `  <name>${xml(name)}</name>`,
    `  <description>${xml(description ?? "")}</description>`,
    "  <sportType>bike</sportType>",
    "  <workout>",
    ...blocks,
    "  </workout>",
    "</workout_file>",
    "",
  ].join("\n");
}
