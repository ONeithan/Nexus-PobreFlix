import { getConfig } from "./config.js";

var currentIndex = 0;
var autoSlideTimeout = null;
var slideStartTime = 0;
var remainingTime = 0;

export function setCurrentIndex(index) {
  currentIndex = index;
}

export function getCurrentIndex() {
  return currentIndex;
}

export function getSlideDuration() {
  return getConfig().sliderDuration;
}

export function setAutoSlideTimeout(timeout) {
  autoSlideTimeout = timeout;
}

export function getAutoSlideTimeout() {
  return autoSlideTimeout;
}

export function setSlideStartTime(time) {
  slideStartTime = time;
}

export function getSlideStartTime() {
  return slideStartTime;
}

export function setRemainingTime(time) {
  remainingTime = time;
}

export function getRemainingTime() {
  return remainingTime;
}

var sliderMemory = {
  lastIndex: 0,
  remainingTime: 0
};

export var saveSliderState = function() {
  sliderMemory = {
    lastIndex: getCurrentIndex(),
    remainingTime: getRemainingTime()
  };
};

export var restoreSliderState = function() {
  if (sliderMemory) {
    setCurrentIndex(sliderMemory.lastIndex);
    setRemainingTime(sliderMemory.remainingTime);
  }
};
