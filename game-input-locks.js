(function (global) {
  var locks = new Set();
  global.GameInputLocks = Object.freeze({
    acquire: function (source) { locks.add(source); return true; },
    release: function (source) { return locks.delete(source); },
    isLocked: function () { return locks.size > 0; },
    has: function (source) { return locks.has(source); }
  });
})(window);
