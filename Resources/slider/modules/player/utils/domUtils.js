import { makeCleanupBag, addEvent } from "./cleanup.js";

export function shuffleArray(array) {
  var result = [...array];
  for (var i = result.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function setupMobileTouchControls() {
  var controls = document.querySelector('.player-controls');
  if (!controls) return;
  var bag = makeCleanupBag(controls);

  var startX, scrollLeft;
  var isDragging = false;

  var onTouchStart = function(e) {
    isDragging = true;
    var rect = controls.getBoundingClientRect();
    startX = e.touches[0].clientX - rect.left;
    scrollLeft = controls.scrollLeft;
  };

  var onTouchMove = function(e) {
    if (!isDragging) return;
    e.preventDefault();
    var rect = controls.getBoundingClientRect();
    var x = e.touches[0].clientX - rect.left;
    var walk = (x - startX) * 2;
    controls.scrollLeft = scrollLeft - walk;
  };

  var onTouchEnd = function() {
    isDragging = false;
  };

  addEvent(bag, controls, 'touchstart', onTouchStart, { passive: false });
  addEvent(bag, controls, 'touchmove',  onTouchMove,  { passive: false });
  addEvent(bag, controls, 'touchend',   onTouchEnd);

  var onMouseDown = function(e) {
    isDragging = true;
    var rect = controls.getBoundingClientRect();
    startX = e.clientX - rect.left;
    scrollLeft = controls.scrollLeft;
    controls.classList.add('dragging');
  };
  var onMouseMove = function(e) {
    if (!isDragging) return;
    e.preventDefault();
    var rect = controls.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var walk = (x - startX) * 2;
    controls.scrollLeft = scrollLeft - walk;
  };
  var onMouseUp = function() {
    isDragging = false;
    controls.classList.remove('dragging');
  };

  addEvent(bag, controls, 'mousedown', onMouseDown);
  addEvent(bag, window,   'mousemove', onMouseMove);
  addEvent(bag, window,   'mouseup',   onMouseUp);
}
