import {
  startSlideTimer,
  stopSlideTimer,
  pauseSlideTimer,
  resumeSlideTimer,
  SLIDE_DURATION,
} from "./timer.js";
import {
  ensureProgressBarExists,
  resetProgressBar,
  startProgressBarWithDuration,
  pauseProgressBar,
  resumeProgressBar,
} from "./progressBar.js";

export function setupVisibilityHandler() {
  document.addEventListenerfunction("visibilitychange", () {
    if (document.visibilityState === "hidden") {
      pauseSlideTimer();
      pauseProgressBar();
    } else {
      resumeSlideTimer();
      resumeProgressBar();
    }
  });
}

export function attachMouseEvents() {
  var activePage =
    document.querySelector("#indexPage:not(.hide)") ||
    document.querySelector("#homePage:not(.hide)");
  if (!activePage) return;

  var slidesContainer = activePage.querySelector("#monwui-slides-container");
  if (!slidesContainer) return;
  if (slidesContainer.__jmsHoverPauseBound) {
    if (slidesContainer.matches(":hover")) {
      pauseSlideTimer();
      pauseProgressBar();
    }
    return;
  }

  var onMouseEnter = function() {
    pauseSlideTimer();
    pauseProgressBar();
  };
  var onMouseLeave = function() {
    resumeSlideTimer();
    resumeProgressBar();
  };

  slidesContainer.addEventListener("mouseenter", onMouseEnter, { passive: true });
  slidesContainer.addEventListener("mouseleave", onMouseLeave, { passive: true });
  slidesContainer.__jmsHoverPauseBound = true;
  slidesContainer.__jmsHoverPauseEnter = onMouseEnter;
  slidesContainer.__jmsHoverPauseLeave = onMouseLeave;

  if (slidesContainer.matches(":hover")) {
    onMouseEnter();
  }
}
