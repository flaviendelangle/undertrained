import * as React from "react";

import { GripVerticalIcon, PlusIcon, Trash2Icon } from "lucide-react";

import { Tree } from "@base-ui/plus/tree";
import { Draggable } from "@base-ui/react/draggable";

import { Button, buttonVariants } from "~/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "~/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { useActivityFilterOptions } from "~/hooks/useActivityFilterOptions";
import { useAthleteId } from "~/hooks/useAthleteId";
import type { AppMessageKey } from "~/i18n/I18nProvider";
import { sportTypeLabel } from "~/i18n/labels";
import { useT } from "~/i18n/useT";
import {
  type ActivityFilterGroup,
  type ActivityFilterNode,
  EMPTY_ACTIVITY_FILTER,
  FILTER_FIELDS,
  type FilterField,
  type FilterOperator,
  activityRulesSchema,
  canonicalRules,
  conditionError,
  createCondition,
  createFilterGroup,
  filterGroupIds,
  getFilterOperators,
  updateFilterNode,
} from "~/utils/activityFilters";
import { WORKOUT_KINDS, type WorkoutKind } from "~/utils/sportConfig";
import { trpc } from "~/utils/trpc";

const inputClass =
  "border-input bg-background h-9 min-w-0 rounded-md border px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const workoutLabels: Record<string, AppMessageKey> = {
  none: "settings.filter.workout.default",
  race: "settings.filter.workout.race",
  long_run: "settings.filter.workout.longRun",
  workout: "settings.filter.workout.workout",
  weight_training: "settings.filter.workout.weightTraining",
} satisfies Record<WorkoutKind, AppMessageKey>;

function FieldSelect({
  value,
  options,
  label,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  label: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
    >
      <Tree.ItemButton
        render={<SelectTrigger size="sm" />}
        aria-label={label}
        className="max-w-full"
      >
        <SelectValue>
          {options.find((o) => o.value === value)?.label}
        </SelectValue>
      </Tree.ItemButton>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Uses the Tree filter-builder recipe: controls, keyboard navigation and reordering share one tree. */
export function ActivityFilterBuilder({
  value: draft,
  onChange,
}: {
  value: ActivityFilterGroup;
  onChange: (rules: ActivityFilterGroup) => void;
}) {
  const t = useT();
  const { allTypes } = useActivityFilterOptions();
  const items = React.useMemo(
    () =>
      Tree.createItems<ActivityFilterNode>([draft], {
        getId: (node) => node.id,
        getLabel: (node) =>
          node.kind === "group"
            ? node.join
            : `${t(`views.fields.${node.field}`)} ${t(`views.operators.${node.operator}`)} ${node.value || node.values.join(", ")}`,
        getChildren: (node) =>
          node.kind === "group" ? node.children : undefined,
        setChildren: (node, children) =>
          node.kind === "group" ? { ...node, children: [...children] } : node,
      }),
    [draft, t],
  );
  const groupIds = filterGroupIds(draft).join(" ");
  const expandedItems = React.useMemo(() => groupIds.split(" "), [groupIds]);
  const update = (
    id: string,
    change: (node: ActivityFilterNode) => ActivityFilterNode | null,
  ) => onChange(updateFilterNode(draft, id, change));
  const add = (id: string, group: boolean) =>
    update(id, (node) =>
      node.kind === "group"
        ? {
            ...node,
            children: [
              ...node.children,
              group ? createFilterGroup() : createCondition(),
            ],
          }
        : node,
    );

  return (
    <div className="min-w-0 px-1">
      <Tree.ReorderProvider<ActivityFilterNode>
        canMoveItems={({ destination }) => destination.parentId !== null}
        isItemReorderable={(_item, { itemId }) => itemId !== draft.id}
        expandDelay={false}
        getDropPosition={({ item, getLocalPoint }) => {
          const y = getLocalPoint().y;
          if (item.kind === "condition") return y < 0.5 ? "before" : "after";
          if (item.id !== draft.id && y < 0.25) return "before";
          if (item.children[0] && y > 0.75)
            return { itemId: item.children[0].id, placement: "before" };
          return "inside";
        }}
      >
        <Tree.Root
          items={items}
          expandedItems={expandedItems}
          selectionMode="none"
          onItemsChange={(next) => {
            if (next[0]?.kind === "group") onChange(next[0]);
          }}
        >
          <Tree.List
            render={<Draggable.Viewport />}
            aria-label={t("views.filterTitle")}
            className="flex flex-col gap-2 py-2"
          >
            {(node: ActivityFilterNode) => {
              const root = node.id === draft.id;
              const error =
                node.kind === "condition"
                  ? conditionError(node)
                  : node !== draft && !node.children.length
                    ? "views.errors.condition"
                    : null;
              const patch = (changes: Partial<ActivityFilterNode>) =>
                update(
                  node.id,
                  (current) =>
                    ({ ...current, ...changes }) as ActivityFilterNode,
                );
              const definition =
                node.kind === "condition"
                  ? FILTER_FIELDS.find((f) => f.id === node.field)!
                  : null;
              return (
                <Tree.Item
                  key={node.id}
                  itemId={node.id}
                  className="focus-visible:ring-ring rounded-md outline-none focus-visible:ring-2"
                  style={{
                    marginInlineStart:
                      "calc((var(--tree-item-level, 1) - 1) * 12px)",
                  }}
                >
                  <Tree.ItemContent className="border-border bg-muted/30 flex flex-wrap items-center gap-2 rounded-md border p-2">
                    {!root && (
                      <Tree.ReorderHandle
                        aria-label={t("views.move")}
                        className="text-muted-foreground cursor-grab touch-none"
                      >
                        <GripVerticalIcon className="size-4" />
                      </Tree.ReorderHandle>
                    )}
                    {node.kind === "group" ? (
                      <>
                        <FieldSelect
                          value={node.join}
                          options={[
                            { value: "AND", label: t("views.and") },
                            { value: "OR", label: t("views.or") },
                          ]}
                          label={t("views.join")}
                          onChange={(join) =>
                            patch({ join: join as "AND" | "OR" })
                          }
                        />
                        {!node.children.length && (
                          <span className="text-muted-foreground text-sm">
                            {t("views.noConditions")}
                          </span>
                        )}
                        <Tree.ItemButton
                          className={buttonVariants({
                            variant: "ghost",
                            size: "sm",
                          })}
                          onClick={() => add(node.id, false)}
                        >
                          <PlusIcon />
                          {t("views.addCondition")}
                        </Tree.ItemButton>
                        <Tree.ItemButton
                          className={buttonVariants({
                            variant: "ghost",
                            size: "sm",
                          })}
                          onClick={() => add(node.id, true)}
                        >
                          <PlusIcon />
                          {t("views.addGroup")}
                        </Tree.ItemButton>
                      </>
                    ) : (
                      <>
                        <FieldSelect
                          value={node.field}
                          options={FILTER_FIELDS.map((f) => ({
                            value: f.id,
                            label: t(`views.fields.${f.id}`),
                          }))}
                          label={t("views.field")}
                          onChange={(field) =>
                            patch({
                              ...createCondition(field as FilterField),
                              id: node.id,
                            })
                          }
                        />
                        <FieldSelect
                          value={node.operator}
                          options={getFilterOperators(node.field).map((op) => ({
                            value: op,
                            label: t(`views.operators.${op}`),
                          }))}
                          label={t("views.operator")}
                          onChange={(operator) =>
                            patch({ operator: operator as FilterOperator })
                          }
                        />
                        {definition?.kind === "set" ? (
                          <Select
                            multiple
                            value={node.values}
                            onValueChange={(values) => patch({ values })}
                          >
                            <Tree.ItemButton
                              render={<SelectTrigger size="sm" />}
                              className="max-w-full min-w-32"
                              aria-label={t("views.values")}
                              aria-invalid={!!error}
                            >
                              <SelectValue>
                                {node.values.length
                                  ? node.values
                                      .map((v) =>
                                        node.field === "sport"
                                          ? sportTypeLabel(v, t)
                                          : t(workoutLabels[v]),
                                      )
                                      .join(", ")
                                  : t("views.values")}
                              </SelectValue>
                            </Tree.ItemButton>
                            <SelectContent>
                              {(node.field === "sport"
                                ? [
                                    ...new Set([
                                      ...(allTypes ?? []),
                                      ...node.values,
                                    ]),
                                  ].sort()
                                : WORKOUT_KINDS
                              ).map((v) => (
                                <SelectItem key={v} value={v}>
                                  {node.field === "sport"
                                    ? sportTypeLabel(v, t)
                                    : t(workoutLabels[v])}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : definition?.kind === "boolean" ? (
                          <FieldSelect
                            value={node.value}
                            label={t("views.value")}
                            options={[
                              { value: "true", label: t("views.yes") },
                              { value: "false", label: t("views.no") },
                            ]}
                            onChange={(value) => patch({ value })}
                          />
                        ) : !["blank", "notBlank"].includes(node.operator) ? (
                          <>
                            <Tree.ItemInput
                              className={`${inputClass} w-full basis-full sm:w-36 sm:flex-1 sm:basis-auto`}
                              type={
                                definition?.kind === "date" &&
                                node.operator !== "last"
                                  ? "date"
                                  : definition?.kind === "number" ||
                                      node.operator === "last"
                                    ? "number"
                                    : "text"
                              }
                              min={node.operator === "last" ? 1 : 0}
                              step="any"
                              aria-label={t("views.value")}
                              aria-invalid={!!error}
                              value={node.value}
                              onChange={(event) =>
                                patch({ value: event.target.value })
                              }
                            />
                            {node.operator === "between" && (
                              <Tree.ItemInput
                                className={`${inputClass} w-full basis-full sm:w-36 sm:flex-1 sm:basis-auto`}
                                type={
                                  definition?.kind === "date"
                                    ? "date"
                                    : "number"
                                }
                                min={0}
                                step="any"
                                aria-label={t("views.valueTo")}
                                value={node.valueTo}
                                onChange={(event) =>
                                  patch({ valueTo: event.target.value })
                                }
                              />
                            )}
                            {node.operator === "last" && (
                              <span className="text-muted-foreground text-sm">
                                {t("views.lastDays")}
                              </span>
                            )}
                          </>
                        ) : null}
                      </>
                    )}
                    {!root && (
                      <Tree.ItemButton
                        className={buttonVariants({
                          variant: "ghost",
                          size: "icon-sm",
                        })}
                        aria-label={t(
                          node.kind === "group"
                            ? "views.removeGroup"
                            : "views.removeCondition",
                        )}
                        onClick={() => update(node.id, () => null)}
                      >
                        <Trash2Icon />
                      </Tree.ItemButton>
                    )}
                    {error && (
                      <span
                        className="text-destructive w-full text-xs"
                        role="status"
                      >
                        {t(error)}
                      </span>
                    )}
                  </Tree.ItemContent>
                  <Tree.ReorderPreview<ActivityFilterNode> className="bg-popover border-border rounded border p-2 shadow-lg">
                    {({ items: dragged }) =>
                      dragged
                        .map((n) =>
                          n.kind === "group"
                            ? n.join
                            : t(`views.fields.${n.field}`),
                        )
                        .join(", ")
                    }
                  </Tree.ReorderPreview>
                </Tree.Item>
              );
            }}
          </Tree.List>
          <Tree.Status className="sr-only" />
        </Tree.Root>
      </Tree.ReorderProvider>
      <div className="flex flex-wrap items-center gap-2 py-3">
        <p className="text-muted-foreground flex-1 text-xs">
          {t("views.localDates")}
        </p>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onChange(EMPTY_ACTIVITY_FILTER)}
        >
          {t("views.clear")}
        </Button>
      </div>
    </div>
  );
}

export function ActivitySelectionPreview({
  rules,
  today,
}: {
  rules: ActivityFilterGroup;
  today: string;
}) {
  const t = useT();
  const athleteId = useAthleteId();
  const [preview, setPreview] = React.useState(rules);
  React.useEffect(() => {
    const timer = setTimeout(() => setPreview(rules), 300);
    return () => clearTimeout(timer);
  }, [rules]);
  const valid = activityRulesSchema.safeParse(rules).success;
  // Canonical so equivalent rules share one cached summary.
  const previewRules = React.useMemo(() => canonicalRules(preview), [preview]);
  const summary = trpc.views.summary.useQuery(
    { athleteId, rules: previewRules, today },
    { enabled: activityRulesSchema.safeParse(preview).success },
  );
  return (
    <div
      aria-live="polite"
      className="text-muted-foreground flex flex-col gap-1 text-xs"
    >
      {!valid || rules !== preview ? (
        t("views.preview")
      ) : summary.isError ? (
        <button
          className="text-left underline"
          onClick={() => void summary.refetch()}
        >
          {t("common.loadError")}
        </button>
      ) : summary.data ? (
        <span>{t("views.activities", { count: summary.data.count })}</span>
      ) : (
        t("common.loading")
      )}
    </div>
  );
}

export function ActivityFilterEditor({
  initial,
  today,
  onApply,
  onClose,
}: {
  initial: ActivityFilterGroup;
  today: string;
  onApply: (rules: ActivityFilterGroup) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = React.useState(initial);
  return (
    <ResponsiveDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ResponsiveDialogContent className="flex max-h-[90dvh] flex-col sm:max-w-4xl">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {t("views.filterTitle")}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t("views.filterHelp")}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="min-h-0 overflow-y-auto">
          <ActivityFilterBuilder value={draft} onChange={setDraft} />
        </div>
        <ResponsiveDialogFooter className="items-center gap-2">
          <div className="mr-auto">
            <ActivitySelectionPreview rules={draft} today={today} />
          </div>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!activityRulesSchema.safeParse(draft).success}
            onClick={() => onApply(draft)}
          >
            {t("views.apply")}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
export { inputClass as viewInputClass };
