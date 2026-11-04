/** A labelled value; a null value renders "--". */
export function StatCard({
  label,
  value,
}: {
  label: string;
  value: string | number | null;
}) {
  return (
    <div className="w-fit">
      <div className="text-muted-foreground text-xs tracking-wider uppercase">
        {label}
      </div>
      <div className="text-foreground font-mono text-lg font-bold">
        {value ?? "--"}
      </div>
    </div>
  );
}
