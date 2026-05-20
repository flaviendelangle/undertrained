import { router } from "./index";
import { accountRouter } from "./routers/account";
import { activitiesRouter } from "./routers/activities";
import { activityStreamsRouter } from "./routers/activityStreams";
import { analyticsRouter } from "./routers/analytics";
import { recordsRouter } from "./routers/records";
import { riderSettingsRouter } from "./routers/riderSettings";
import { syncRouter } from "./routers/sync";
import { timePeriodsRouter } from "./routers/timePeriods";
import { uploadRouter } from "./routers/upload";

export const appRouter = router({
  account: accountRouter,
  activities: activitiesRouter,
  activityStreams: activityStreamsRouter,
  analytics: analyticsRouter,
  records: recordsRouter,
  riderSettings: riderSettingsRouter,
  sync: syncRouter,
  timePeriods: timePeriodsRouter,
  upload: uploadRouter,
});

export type AppRouter = typeof appRouter;
