import { useEffect } from "react";
import ReactGA from "react-ga";

export function useInitializeGoogleAnalytics() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production") {
      ReactGA.initialize("UA-130599982-3", { debug: true });
    }
  }, []);
}

export function useSendGaPageview(path) {
  useEffect(() => {
    if (process.env.NODE_ENV === "production") {
      const trimmedPath = path.trim();
      // ReactGA's `pageview` method doesn't call `set` first, as recommended by:
      // https://developers.google.com/analytics/devguides/collection/analyticsjs/single-page-applications
      // Calling `set` allows all future events to be linked to page they originated from.
      ReactGA.set({ page: trimmedPath });
      ReactGA.pageview(trimmedPath);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function sendGaEvent(eventCategory, eventAction, eventLabel) {
  if (process.env.NODE_ENV === "production") {
    ReactGA.event({ category: eventCategory, action: eventAction, label: eventLabel });
  }
}
