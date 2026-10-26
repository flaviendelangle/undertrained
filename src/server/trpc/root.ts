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
import { structuredWorkoutsRouter } from "./routers/structuredWorkouts";
import { syncRouter } from "./routers/sync";
import { uploadRouter } from "./routers/upload";
import { viewsRouter } from "./routers/views";

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
  structuredWorkouts: structuredWorkoutsRouter,
  sync: syncRouter,
  upload: uploadRouter,
  views: viewsRouter,
});

export type AppRouter = typeof appRouter;
