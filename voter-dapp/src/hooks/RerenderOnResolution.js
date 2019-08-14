import { useEffect, useState } from "react";

export default function useRerenderOnResolution(promise) {
  // Just use a counter to trigger a fake state update when the promise resolves.
  const [, setCounter] = useState(0);

  useEffect(() => {
    let cancel = false;

    promise.then(() => {
      if (cancel) {
        return;
      }

      // Rerender.
      setCounter(counter => {
        return counter + 1;
      });
    });

    // If a new promise is passed before the previous one resolves, set cancel to true so the old one doesn't trigger an additional rerender.
    return () => {
      cancel = true;
    };
  }, [promise]);
}
