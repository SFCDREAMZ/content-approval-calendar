/* Content Approval Calendar
 * Static, dependency-free. State persists in localStorage. */

(function () {
  "use strict";

  var STORAGE_KEY = "cac.posts.v1";

  var PLATFORMS = {
    facebook:  { label: "Facebook",  icon: "f" },
    instagram: { label: "Instagram", icon: "◉" }
  };

  var STATUSES = {
    pending:  { label: "Pending",           cls: "status-pending"  },
    approved: { label: "Approved",          cls: "status-approved" },
    changes:  { label: "Changes Requested", cls: "status-changes"  }
  };

  var MONTH_NAMES = ["January","February","March","April","May","June",
    "July","August","September","October","November","December"];

  /* ---- Sample data: ~8 posts across June 2026 ---- */
  function seedPosts() {
    return [
      { id: "p1", date: "2026-06-02", platform: "instagram", type: "Reel",
        caption: "Behind-the-scenes of our summer photoshoot — sneak peek at the new collection!",
        status: "pending", notes: "" },
      { id: "p2", date: "2026-06-05", platform: "facebook", type: "Photo",
        caption: "Meet the team Friday: introducing our lead designer and what inspires her work.",
        status: "approved", notes: "Looks great — approved." },
      { id: "p3", date: "2026-06-09", platform: "instagram", type: "Carousel",
        caption: "5 tips to refresh your brand this summer. Swipe through for the full breakdown.",
        status: "pending", notes: "" },
      { id: "p4", date: "2026-06-12", platform: "facebook", type: "Link",
        caption: "New on the blog: how small businesses can plan a content calendar that actually sticks.",
        status: "changes", notes: "Please shorten the caption and add the blog link tracking tag." },
      { id: "p5", date: "2026-06-16", platform: "instagram", type: "Story",
        caption: "Flash poll: which color palette should we feature next? Vote in stories today!",
        status: "pending", notes: "" },
      { id: "p6", date: "2026-06-19", platform: "facebook", type: "Video",
        caption: "Client spotlight — a 60-second look at the campaign that doubled their reach.",
        status: "approved", notes: "" },
      { id: "p7", date: "2026-06-23", platform: "instagram", type: "Photo",
        caption: "Mid-week motivation: a clean workspace and a clear plan. ✨ #SocialFlare",
        status: "pending", notes: "" },
      { id: "p8", date: "2026-06-27", platform: "facebook", type: "Photo",
        caption: "Weekend reminder: book your July content session before slots fill up.",
        status: "pending", notes: "" }
    ];
  }

  /* ---- State ---- */
  var posts = loadPosts();
  var view = new Date(2026, 5, 1); // June 2026 to match sample data
  var activeId = null;

  function loadPosts() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      }
    } catch (e) { /* ignore corrupt storage */ }
    var seeded = seedPosts();
    savePosts(seeded);
    return seeded;
  }

  function savePosts(data) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data || posts)); }
    catch (e) { /* storage may be unavailable; app still works in-memory */ }
  }

  /* ---- Helpers ---- */
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function dateKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }

  function postsForDate(key) {
    return posts.filter(function (p) { return p.date === key; });
  }

  function getPost(id) {
    for (var i = 0; i < posts.length; i++) { if (posts[i].id === id) return posts[i]; }
    return null;
  }

  function formatLongDate(key) {
    var parts = key.split("-");
    var d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    var weekdays = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    return weekdays[d.getDay()] + ", " + MONTH_NAMES[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
  }

  /* ---- Rendering ---- */
  function renderSummary() {
    var total = posts.length, approved = 0, pending = 0, changes = 0;
    posts.forEach(function (p) {
      if (p.status === "approved") approved++;
      else if (p.status === "changes") changes++;
      else pending++;
    });
    document.getElementById("stat-total").textContent = total;
    document.getElementById("stat-approved").textContent = approved;
    document.getElementById("stat-pending").textContent = pending;
    document.getElementById("stat-changes").textContent = changes;
  }

  function renderCalendar() {
    var year = view.getFullYear();
    var month = view.getMonth();
    document.getElementById("month-title").textContent = MONTH_NAMES[month] + " " + year;

    var grid = document.getElementById("calendar-grid");
    grid.innerHTML = "";

    var first = new Date(year, month, 1);
    var startOffset = first.getDay();          // 0 = Sunday
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var todayKey = dateKey(new Date());

    // Build a 6-row grid so layout stays stable across months.
    var startDate = new Date(year, month, 1 - startOffset);
    for (var i = 0; i < 42; i++) {
      var cellDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i);
      var inMonth = cellDate.getMonth() === month;
      var key = dateKey(cellDate);

      var cell = document.createElement("div");
      cell.className = "day-cell" + (inMonth ? "" : " is-outside") + (key === todayKey ? " is-today" : "");

      var num = document.createElement("div");
      num.className = "day-number";
      num.textContent = cellDate.getDate();
      cell.appendChild(num);

      postsForDate(key).forEach(function (p) { cell.appendChild(buildChip(p)); });

      grid.appendChild(cell);
    }

    // Trim trailing empty week if it has no in-month days (keeps grid tight).
    trimTrailingEmptyWeek(grid, month);
  }

  function trimTrailingEmptyWeek(grid, month) {
    var cells = grid.children;
    if (cells.length < 42) return;
    var lastRowEmpty = true;
    for (var i = 35; i < 42; i++) {
      if (!cells[i].classList.contains("is-outside")) { lastRowEmpty = false; break; }
    }
    if (lastRowEmpty) {
      for (var j = 41; j >= 35; j--) { grid.removeChild(cells[j]); }
    }
  }

  function buildChip(p) {
    var chip = document.createElement("button");
    chip.type = "button";
    chip.className = "post-chip platform-" + p.platform;
    chip.setAttribute("data-id", p.id);

    var top = document.createElement("div");
    top.className = "post-chip-top";

    var dot = document.createElement("span");
    dot.className = "platform-dot";
    top.appendChild(dot);

    var type = document.createElement("span");
    type.className = "post-type";
    type.textContent = p.type;
    top.appendChild(type);

    var status = document.createElement("span");
    status.className = "status-dot " + STATUSES[p.status].cls;
    top.appendChild(status);

    chip.appendChild(top);

    var cap = document.createElement("span");
    cap.className = "post-caption";
    cap.textContent = p.caption;
    chip.appendChild(cap);

    chip.addEventListener("click", function () { openModal(p.id); });
    return chip;
  }

  /* ---- Modal ---- */
  function openModal(id) {
    var p = getPost(id);
    if (!p) return;
    activeId = id;

    var thumb = document.getElementById("modal-thumb");
    thumb.className = "modal-thumb platform-" + p.platform;
    thumb.textContent = PLATFORMS[p.platform].icon;

    var plat = document.getElementById("modal-platform");
    plat.className = "platform-tag platform-" + p.platform;
    plat.textContent = PLATFORMS[p.platform].label;

    document.getElementById("modal-type").textContent = p.type;

    var statusEl = document.getElementById("modal-status");
    statusEl.className = "status-pill " + STATUSES[p.status].cls;
    statusEl.textContent = STATUSES[p.status].label;

    document.getElementById("modal-date").textContent = formatLongDate(p.date);
    document.getElementById("modal-caption").textContent = p.caption;
    document.getElementById("modal-notes").value = p.notes || "";

    document.getElementById("modal-overlay").hidden = false;
    document.getElementById("modal-notes").focus();
  }

  function closeModal() {
    document.getElementById("modal-overlay").hidden = true;
    activeId = null;
  }

  function setStatus(status) {
    if (!activeId) return;
    var p = getPost(activeId);
    if (!p) return;
    p.status = status;
    p.notes = document.getElementById("modal-notes").value.trim();
    savePosts();
    renderSummary();
    renderCalendar();
    closeModal();
  }

  /* ---- Events ---- */
  function init() {
    document.getElementById("prev-month").addEventListener("click", function () {
      view = new Date(view.getFullYear(), view.getMonth() - 1, 1);
      renderCalendar();
    });
    document.getElementById("next-month").addEventListener("click", function () {
      view = new Date(view.getFullYear(), view.getMonth() + 1, 1);
      renderCalendar();
    });
    document.getElementById("today-btn").addEventListener("click", function () {
      var now = new Date();
      view = new Date(now.getFullYear(), now.getMonth(), 1);
      renderCalendar();
    });

    document.getElementById("modal-close").addEventListener("click", closeModal);
    document.getElementById("modal-overlay").addEventListener("click", function (e) {
      if (e.target === this) closeModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeModal();
    });
    document.getElementById("btn-approve").addEventListener("click", function () { setStatus("approved"); });
    document.getElementById("btn-request-changes").addEventListener("click", function () { setStatus("changes"); });

    renderSummary();
    renderCalendar();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
