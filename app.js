/* Content Approval Calendar
 * Static, no build step. Data lives in Supabase.
 *
 *  Two modes, chosen by the URL:
 *   - ADMIN  (default)            : sign in, manage clients & posts.
 *   - CLIENT (?client=TOKEN)      : read-only review, approve / request changes.
 */

(function () {
  "use strict";

  /* ---------------- Supabase ---------------- */
  // These are public by design (the anon key is safe to ship in the browser).
  var SUPABASE_URL = "https://xsaswfrbtsfvquttrdml.supabase.co";
  var SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhzYXN3ZnJidHNmdnF1dHRyZG1sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0MTU5NTUsImV4cCI6MjA5Nzk5MTk1NX0.6dEJhmHmU7d5JvKsjA9eRFwkNVBTQaKmubUfo4dwDdA";

  var db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  /* ---------------- Constants ---------------- */
  var PLATFORMS = {
    facebook:  { label: "Facebook",  icon: "f" },
    instagram: { label: "Instagram", icon: "◉" }
  };

  var STATUSES = {
    pending:            { label: "Pending",           cls: "status-pending"  },
    approved:           { label: "Approved",          cls: "status-approved" },
    changes_requested:  { label: "Changes Requested", cls: "status-changes"  }
  };

  var MONTH_NAMES = ["January","February","March","April","May","June",
    "July","August","September","October","November","December"];

  /* ---------------- State ---------------- */
  var params      = new URLSearchParams(window.location.search);
  var reviewToken = params.get("client");
  var MODE        = reviewToken ? "client" : "admin";

  var posts           = [];     // posts currently shown (selected client / review)
  var clients         = [];     // admin: list of clients
  var currentClientId = null;   // admin: selected client
  var clientName      = "";     // display name for header
  var view            = new Date();
  view = new Date(view.getFullYear(), view.getMonth(), 1);
  var activeId  = null;         // post open in the review modal
  var editingId = null;         // post open in the editor (null = adding)

  /* ---------------- Small DOM helpers ---------------- */
  function $(id) { return document.getElementById(id); }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function dateKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }

  function showBanner(msg, kind) {
    var b = $("banner");
    b.textContent = msg;
    b.className = "banner" + (kind ? " banner-" + kind : "");
    b.hidden = !msg;
  }

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

  /* ---------------- Rendering ---------------- */
  function renderSummary() {
    var total = posts.length, approved = 0, pending = 0, changes = 0;
    posts.forEach(function (p) {
      if (p.status === "approved") approved++;
      else if (p.status === "changes_requested") changes++;
      else pending++;
    });
    $("stat-total").textContent    = total;
    $("stat-approved").textContent = approved;
    $("stat-pending").textContent  = pending;
    $("stat-changes").textContent  = changes;
  }

  function renderCalendar() {
    var year = view.getFullYear();
    var month = view.getMonth();
    $("month-title").textContent = MONTH_NAMES[month] + " " + year;

    var grid = $("calendar-grid");
    grid.innerHTML = "";

    var first = new Date(year, month, 1);
    var startOffset = first.getDay();          // 0 = Sunday
    var todayKey = dateKey(new Date());

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

      // Admin: click an empty part of an in-month cell to add a post on that day.
      if (MODE === "admin" && inMonth) {
        cell.classList.add("is-clickable");
        (function (k) {
          cell.addEventListener("click", function (e) {
            if (e.target === cell || e.target === num) openEditor(null, k);
          });
        })(key);
      }

      grid.appendChild(cell);
    }
    trimTrailingEmptyWeek(grid);
  }

  function trimTrailingEmptyWeek(grid) {
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
    type.textContent = p.post_type;
    top.appendChild(type);

    var status = document.createElement("span");
    status.className = "status-dot " + (STATUSES[p.status] || STATUSES.pending).cls;
    top.appendChild(status);

    chip.appendChild(top);

    var cap = document.createElement("span");
    cap.className = "post-caption";
    cap.textContent = p.caption;
    chip.appendChild(cap);

    chip.addEventListener("click", function (e) {
      e.stopPropagation();
      if (MODE === "admin") openEditor(p.id);
      else openReview(p.id);
    });
    return chip;
  }

  function setThumb(el, p) {
    el.className = "modal-thumb platform-" + p.platform;
    if (p.image_url) {
      el.style.backgroundImage = "url('" + p.image_url.replace(/'/g, "%27") + "')";
      el.textContent = "";
    } else {
      el.style.backgroundImage = "";
      el.textContent = (PLATFORMS[p.platform] || {}).icon || "";
    }
  }

  /* ---------------- Client review modal ---------------- */
  function openReview(id) {
    var p = getPost(id);
    if (!p) return;
    activeId = id;

    setThumb($("modal-thumb"), p);

    var plat = $("modal-platform");
    plat.className = "platform-tag platform-" + p.platform;
    plat.textContent = (PLATFORMS[p.platform] || {}).label || p.platform;

    $("modal-type").textContent = p.post_type;

    var statusEl = $("modal-status");
    var st = STATUSES[p.status] || STATUSES.pending;
    statusEl.className = "status-pill " + st.cls;
    statusEl.textContent = st.label;

    $("modal-date").textContent = formatLongDate(p.date);
    $("modal-caption").textContent = p.caption;
    $("modal-notes").value = p.reviewer_notes || "";

    $("modal-overlay").hidden = false;
    $("modal-notes").focus();
  }
  function closeReview() {
    $("modal-overlay").hidden = true;
    activeId = null;
  }

  async function submitReview(status) {
    if (!activeId) return;
    var notes = $("modal-notes").value.trim();
    var approveBtn = $("btn-approve"), changesBtn = $("btn-request-changes");
    approveBtn.disabled = changesBtn.disabled = true;
    try {
      var res = await db.rpc("submit_review", {
        p_token: reviewToken,
        p_post_id: activeId,
        p_status: status,
        p_notes: notes
      });
      if (res.error) throw res.error;
      var p = getPost(activeId);
      if (p) { p.status = status; p.reviewer_notes = notes; }
      renderSummary();
      renderCalendar();
      closeReview();
    } catch (err) {
      alert("Could not save your review: " + (err.message || err));
    } finally {
      approveBtn.disabled = changesBtn.disabled = false;
    }
  }

  /* ---------------- Admin: post editor ---------------- */
  function openEditor(id, presetDate) {
    editingId = id || null;
    var p = id ? getPost(id) : null;

    $("editor-title").textContent = p ? "Edit post" : "Add post";
    $("f-date").value     = p ? p.date : (presetDate || dateKey(new Date()));
    $("f-platform").value = p ? p.platform : "facebook";
    $("f-type").value     = p ? p.post_type : "Photo";
    $("f-caption").value  = p ? p.caption : "";
    $("f-image").value    = p ? (p.image_url || "") : "";
    $("editor-delete").hidden = !p;

    $("editor-overlay").hidden = false;
    $("f-caption").focus();
  }
  function closeEditor() {
    $("editor-overlay").hidden = true;
    editingId = null;
  }

  async function saveEditor(e) {
    e.preventDefault();
    if (!currentClientId) { alert("Create or select a client first."); return; }

    var record = {
      client_id: currentClientId,
      date:      $("f-date").value,
      platform:  $("f-platform").value,
      post_type: $("f-type").value,
      caption:   $("f-caption").value.trim(),
      image_url: $("f-image").value.trim() || null
    };
    if (!record.date) { alert("Please pick a date."); return; }

    var saveBtn = $("editor-save");
    saveBtn.disabled = true;
    try {
      if (editingId) {
        var up = await db.from("posts").update(record).eq("id", editingId);
        if (up.error) throw up.error;
      } else {
        var ins = await db.from("posts").insert(record);
        if (ins.error) throw ins.error;
      }
      closeEditor();
      await loadAdminPosts();
    } catch (err) {
      alert("Could not save the post: " + (err.message || err));
    } finally {
      saveBtn.disabled = false;
    }
  }

  async function deletePost() {
    if (!editingId) return;
    if (!window.confirm("Delete this post? This cannot be undone.")) return;
    try {
      var res = await db.from("posts").delete().eq("id", editingId);
      if (res.error) throw res.error;
      closeEditor();
      await loadAdminPosts();
    } catch (err) {
      alert("Could not delete the post: " + (err.message || err));
    }
  }

  /* ---------------- Admin: clients ---------------- */
  function renderClientOptions() {
    var sel = $("client-select");
    sel.innerHTML = "";
    if (!clients.length) {
      var opt = document.createElement("option");
      opt.value = ""; opt.textContent = "No clients yet";
      sel.appendChild(opt);
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    clients.forEach(function (c) {
      var o = document.createElement("option");
      o.value = c.id; o.textContent = c.name;
      sel.appendChild(o);
    });
    sel.value = currentClientId || clients[0].id;
  }

  async function loadClients() {
    var res = await db.from("clients").select("*").order("created_at", { ascending: true });
    if (res.error) { showBanner("Could not load clients: " + res.error.message, "error"); return; }
    clients = res.data || [];
    if (clients.length && !currentClientId) currentClientId = clients[0].id;
    if (currentClientId && !clients.some(function (c) { return c.id === currentClientId; })) {
      currentClientId = clients.length ? clients[0].id : null;
    }
    renderClientOptions();
  }

  async function loadAdminPosts() {
    if (!currentClientId) {
      posts = [];
      showBanner("Create your first client to start adding posts.", "");
      renderSummary(); renderCalendar();
      return;
    }
    var res = await db.from("posts").select("*")
      .eq("client_id", currentClientId)
      .order("date", { ascending: true });
    if (res.error) { showBanner("Could not load posts: " + res.error.message, "error"); return; }
    posts = res.data || [];
    var c = clients.filter(function (x) { return x.id === currentClientId; })[0];
    clientName = c ? c.name : "";
    showBanner("");
    renderSummary(); renderCalendar();
  }

  async function newClient() {
    var name = window.prompt("New client name:");
    if (!name) return;
    name = name.trim();
    if (!name) return;
    var res = await db.from("clients").insert({ name: name }).select().single();
    if (res.error) { alert("Could not create client: " + res.error.message); return; }
    currentClientId = res.data.id;
    await loadClients();
    renderClientOptions();
    await loadAdminPosts();
  }

  function reviewLinkFor(clientId) {
    var c = clients.filter(function (x) { return x.id === clientId; })[0];
    if (!c) return null;
    var base = window.location.origin + window.location.pathname;
    return base + "?client=" + encodeURIComponent(c.review_token);
  }

  async function copyReviewLink() {
    if (!currentClientId) { alert("Select a client first."); return; }
    var link = reviewLinkFor(currentClientId);
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      showBanner("Review link copied to clipboard ✓", "ok");
      setTimeout(function () { showBanner(""); }, 4000);
    } catch (e) {
      window.prompt("Copy this client review link:", link);
    }
  }

  /* ---------------- Admin: auth ---------------- */
  function showLogin(show) {
    $("login-overlay").hidden = !show;
    if (show) {
      var err = $("login-error");
      if (err) err.hidden = true;
      $("login-submit").disabled = false;
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    var email = $("login-email").value.trim();
    var password = $("login-password").value;
    var err = $("login-error");
    err.hidden = true;
    $("login-submit").disabled = true;
    try {
      var res = await db.auth.signInWithPassword({ email: email, password: password });
      if (res.error) throw res.error;
      // onAuthStateChange handles the rest.
    } catch (ex) {
      err.textContent = ex.message || "Sign in failed.";
      err.hidden = false;
    } finally {
      $("login-submit").disabled = false;
    }
  }

  // Tracks the rendered auth view so applyAuth() can stay idempotent and we
  // never double-load (onAuthStateChange + the initial getSession can race).
  var authView = null; // "in" | "out" | null

  // IMPORTANT: never call a supabase.auth.* method (getSession, etc.) from
  // inside the onAuthStateChange callback — the client holds an auth lock
  // while dispatching it, so a nested auth call deadlocks (sign-in never
  // resolves, UI never updates). We take the session as an argument instead,
  // and applyAuth() is always invoked deferred / outside the callback.
  function applyAuth(session) {
    var next = session ? "in" : "out";
    if (next === authView) {
      // Already showing the right view; just keep the email fresh.
      if (session) $("user-email").textContent = session.user ? session.user.email : "";
      return;
    }
    authView = next;
    if (session) enterAdmin(session);
    else exitAdmin();
  }

  async function enterAdmin(session) {
    showLogin(false);
    $("login-submit").disabled = false; // ensure the button isn't stuck disabled
    $("admin-toolbar").hidden = false;
    $("header-actions").hidden = false;
    $("signin-btn").hidden = true;       // logged in → offer Sign out, not Sign in
    $("signout-btn").hidden = false;
    var user = session ? session.user : null;
    $("user-email").textContent = user ? user.email : "";
    $("brand-sub").textContent = "Admin — manage clients and scheduled posts.";
    await loadClients();
    await loadAdminPosts();
  }

  function exitAdmin() {
    $("admin-toolbar").hidden = true;
    $("header-actions").hidden = false;  // keep the header bar so Sign in is reachable
    $("signin-btn").hidden = false;
    $("signout-btn").hidden = true;
    $("user-email").textContent = "";
    posts = []; clients = []; currentClientId = null;
    $("brand-sub").textContent = "Sign in to manage the calendar.";
    renderSummary(); renderCalendar();
    showLogin(true);
  }

  /* ---------------- Client mode bootstrap ---------------- */
  async function enterClient() {
    $("brand-sub").textContent = "Loading review…";
    var res = await db.rpc("get_client_review", { p_token: reviewToken });
    if (res.error) {
      showBanner("Could not load this review link: " + res.error.message, "error");
      return;
    }
    if (!res.data) {
      $("brand-sub").textContent = "This review link is invalid or has expired.";
      showBanner("We couldn't find anything for this link. Please ask for a fresh one.", "error");
      return;
    }
    clientName = res.data.client.name;
    posts = res.data.posts || [];
    $("brand-sub").textContent = "Reviewing content for " + clientName + ".";
    // Jump to the month of the earliest post, if any.
    if (posts.length) {
      var earliest = posts.map(function (p) { return p.date; }).sort()[0];
      var parts = earliest.split("-");
      view = new Date(+parts[0], +parts[1] - 1, 1);
    }
    renderSummary();
    renderCalendar();
  }

  /* ---------------- Events ---------------- */
  function wireCommon() {
    $("prev-month").addEventListener("click", function () {
      view = new Date(view.getFullYear(), view.getMonth() - 1, 1); renderCalendar();
    });
    $("next-month").addEventListener("click", function () {
      view = new Date(view.getFullYear(), view.getMonth() + 1, 1); renderCalendar();
    });
    $("today-btn").addEventListener("click", function () {
      var now = new Date(); view = new Date(now.getFullYear(), now.getMonth(), 1); renderCalendar();
    });

    // Review modal
    $("modal-close").addEventListener("click", closeReview);
    $("modal-overlay").addEventListener("click", function (e) { if (e.target === this) closeReview(); });
    $("btn-approve").addEventListener("click", function () { submitReview("approved"); });
    $("btn-request-changes").addEventListener("click", function () { submitReview("changes_requested"); });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeReview();
        if (MODE === "admin") { closeEditor(); showLogin(false); }
      }
    });
  }

  function wireAdmin() {
    $("client-select").addEventListener("change", function () {
      currentClientId = this.value || null;
      loadAdminPosts();
    });
    $("new-client-btn").addEventListener("click", newClient);
    $("add-post-btn").addEventListener("click", function () { openEditor(null); });
    $("copy-link-btn").addEventListener("click", copyReviewLink);

    $("editor-close").addEventListener("click", closeEditor);
    $("editor-overlay").addEventListener("click", function (e) { if (e.target === this) closeEditor(); });
    $("editor-form").addEventListener("submit", saveEditor);
    $("editor-delete").addEventListener("click", deletePost);

    $("login-form").addEventListener("submit", handleLogin);
    $("login-close").addEventListener("click", function () { showLogin(false); });
    $("login-overlay").addEventListener("click", function (e) { if (e.target === this) showLogin(false); });
    $("signin-btn").addEventListener("click", function () { showLogin(true); });
    $("signout-btn").addEventListener("click", function () { db.auth.signOut(); });
  }

  /* ---------------- Init ---------------- */
  async function init() {
    wireCommon();
    renderSummary();
    renderCalendar();

    if (MODE === "client") {
      await enterClient();
      return;
    }

    // Admin mode.
    wireAdmin();

    // React to sign-in / sign-out. onAuthStateChange also fires an
    // INITIAL_SESSION event on setup, so a returning logged-in user is routed
    // straight into the admin view. The callback body is deferred with
    // setTimeout(…, 0) so it runs OUTSIDE the auth-lock context — calling
    // supabase methods (loadClients, etc.) directly inside the callback would
    // deadlock and leave the sign-in button stuck.
    db.auth.onAuthStateChange(function (event, session) {
      if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") return;
      setTimeout(function () { applyAuth(session); }, 0);
    });

    // Fallback: explicitly check for an existing session on load, in case
    // INITIAL_SESSION hasn't fired yet. applyAuth() is idempotent, so this
    // races safely with the listener above.
    try {
      var sess = await db.auth.getSession();
      applyAuth(sess.data.session);
    } catch (e) {
      applyAuth(null);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
