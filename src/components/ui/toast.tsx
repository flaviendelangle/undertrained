import { XIcon } from "lucide-react";

import { Toast } from "@base-ui/react/toast";

import { useT } from "~/i18n/useT";

const appToastManager = Toast.createToastManager();

export function showErrorToast(description: string) {
  return appToastManager.add({
    description,
    type: "error",
    priority: "high",
  });
}

function ToastList() {
  const t = useT();
  const { toasts } = Toast.useToastManager();

  return (
    <Toast.Portal>
      <Toast.Viewport className="fixed right-4 bottom-4 z-[100] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2 outline-none">
        {toasts.map((toast) => (
          <Toast.Root
            key={toast.id}
            toast={toast}
            swipeDirection="right"
            className="bg-background ring-foreground/10 data-[type=error]:ring-destructive/30 relative flex w-full [transform:translateX(var(--toast-swipe-movement-x))] items-start gap-3 rounded-xl p-4 pr-10 text-sm shadow-lg ring-1 transition-[opacity,transform] duration-150 data-ending-style:translate-y-2 data-ending-style:opacity-0 data-starting-style:translate-y-2 data-starting-style:opacity-0 data-swiping:select-none"
          >
            <Toast.Content className="min-w-0 flex-1">
              {toast.title && (
                <Toast.Title className="font-medium">{toast.title}</Toast.Title>
              )}
              {toast.description && (
                <Toast.Description className="text-muted-foreground">
                  {toast.description}
                </Toast.Description>
              )}
            </Toast.Content>
            <Toast.Close
              aria-label={t("common.dismiss")}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute top-2.5 right-2.5 flex size-7 items-center justify-center rounded-md outline-none focus-visible:ring-2"
            >
              <XIcon className="size-4" />
            </Toast.Close>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <Toast.Provider toastManager={appToastManager} timeout={5000} limit={3}>
      {children}
      <ToastList />
    </Toast.Provider>
  );
}
