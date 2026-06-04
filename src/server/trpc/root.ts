import { router } from "./index";
import { accountRouter } from "./routers/account";
import { activitiesRouter } from "./routers/activities";
import { activityStreamsRouter } from "./routers/activityStreams";
import { analyticsRouter } from "./routers/analytics";
import { calendarSubscriptionsRouter } from "./routers/calendarSubscriptions";
import { plannedTrainingsRouter } from "./routers/plannedTrainings";
import { recordsRouter } from "./routers/records";
import { riderSettingsRouter } from "./routers/riderSettings";
import { routesRouter } from "./routers/routes";
import { syncRouter } from "./routers/sync";
import { timePeriodsRouter } from "./routers/timePeriods";
import { uploadRouter } from "./routers/upload";

export const appRouter = router({
  account: accountRouter,
  activities: activitiesRouter,
  activityStreams: activityStreamsRouter,
  analytics: analyticsRouter,
  calendarSubscriptions: calendarSubscriptionsRouter,
  plannedTrainings: plannedTrainingsRouter,
  records: recordsRouter,
  riderSettings: riderSettingsRouter,
  routes: routesRouter,
  sync: syncRouter,
  timePeriods: timePeriodsRouter,
  upload: uploadRouter,
});

export type AppRouter = typeof appRouter;
