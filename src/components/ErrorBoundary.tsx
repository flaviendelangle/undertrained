import React from "react";

import { useT } from "~/i18n/useT";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/** Default fallback; a function component so it can read the translator. */
function DefaultErrorFallback() {
  const t = useT();
  return (
    <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
      {t("errors.somethingWentWrong")}
    </div>
  );
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? <DefaultErrorFallback />;
    }

    return this.props.children;
  }
}
