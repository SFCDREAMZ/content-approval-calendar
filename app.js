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
  // Order here drives the platform dropdown.
  var PLATFORMS = {
    linkedin:  { label: "LinkedIn",  icon: "in" },
    tiktok:    { label: "TikTok",    icon: "♪"  },
    pinterest: { label: "Pinterest", icon: "P"  },
    instagram: { label: "Instagram", icon: "◉"  },
    facebook:  { label: "Facebook",  icon: "f"  },
    gbp:       { label: "Google Business", icon: "G" }
  };

  var STATUSES = {
    pending:            { label: "Pending",           cls: "status-pending"  },
    approved:           { label: "Approved",          cls: "status-approved" },
    changes_requested:  { label: "Changes Requested", cls: "status-changes"  },
    posted:             { label: "Posted",            cls: "status-posted"   }
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
  var adminView = "calendar";   // admin: "calendar" | "queue"

  // Editor media state. Precedence on save: pendingFile > pasted URL > existing.
  var pendingFile       = null; // File chosen but not yet uploaded
  var existingMediaUrl  = null; // media already on the post being edited
  var existingMediaType = null;
  var lastObjectUrl     = null; // object URL for the local preview (revoked on clear)

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

  // Format an ISO timestamp (publish_at) as a friendly local date + time.
  function formatPublishAt(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var h = d.getHours();
    var ampm = h >= 12 ? "PM" : "AM";
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    return MONTH_NAMES[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear() +
      " · " + h12 + ":" + pad(d.getMinutes()) + " " + ampm;
  }

  // Short time only (e.g. "9:30 AM"), for compact calendar chips.
  function formatPublishTime(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var h = d.getHours();
    var ampm = h >= 12 ? "PM" : "AM";
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + ":" + pad(d.getMinutes()) + " " + ampm;
  }

  // Convert an ISO timestamp into the value a <input type="datetime-local">
  // expects (local "YYYY-MM-DDTHH:MM"), and back.
  function isoToLocalInput(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function localInputToIso(val) {
    if (!val) return null;
    var d = new Date(val);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  /* ---------------- Media helpers ---------------- */
  var IMG_EXT = ["jpg", "jpeg", "png", "webp", "gif"];
  var VID_EXT = ["mp4", "mov", "m4v", "webm", "ogv"];

  function extOf(name) {
    return (name.split("?")[0].split("#")[0].split(".").pop() || "").toLowerCase();
  }
  function mediaTypeForFile(file) {
    if (file.type) {
      if (file.type.indexOf("video/") === 0) return "video";
      if (file.type.indexOf("image/") === 0) return "image";
    }
    return VID_EXT.indexOf(extOf(file.name)) >= 0 ? "video" : "image";
  }
  function mediaTypeForUrl(url) {
    return VID_EXT.indexOf(extOf(url)) >= 0 ? "video" : "image";
  }
  function isAcceptedMedia(file) {
    if (file.type.indexOf("video/") === 0 || file.type.indexOf("image/") === 0) return true;
    var e = extOf(file.name);
    return IMG_EXT.indexOf(e) >= 0 || VID_EXT.indexOf(e) >= 0;
  }

  // A post's media, tolerant of legacy rows that only had `image_url`.
  function postMediaUrl(p) { return p.media_url || p.image_url || ""; }
  function postMediaType(p) {
    if (p.media_type) return p.media_type;
    var u = postMediaUrl(p);
    return u ? mediaTypeForUrl(u) : "";
  }

  // Build a media element (image, or HTML5 <video>). `opts.controls` shows a
  // real player; otherwise a quiet first-frame preview with a ▶ badge.
  function buildMedia(url, type, opts) {
    opts = opts || {};
    var wrap = document.createElement("div");
    wrap.className = "media" + (opts.cls ? " " + opts.cls : "");
    if (type === "video") {
      wrap.classList.add("is-video");
      var v = document.createElement("video");
      v.src = url;
      v.preload = "metadata";
      v.playsInline = true;
      if (opts.controls) {
        v.controls = true;            // playable, but never autoplay
      } else {
        v.tabIndex = -1;
        v.muted = true;
        var badge = document.createElement("span");
        badge.className = "play-badge";
        badge.textContent = "▶";
        wrap.appendChild(badge);
      }
      wrap.insertBefore(v, wrap.firstChild);
    } else {
      var img = document.createElement("img");
      img.src = url;
      img.alt = opts.alt || "";
      img.loading = "lazy";
      wrap.appendChild(img);
    }
    return wrap;
  }

  /* ---------------- Rendering ---------------- */
  function renderSummary() {
    var total = posts.length, approved = 0, pending = 0, changes = 0, posted = 0;
    posts.forEach(function (p) {
      if (p.status === "approved") approved++;
      else if (p.status === "changes_requested") changes++;
      else if (p.status === "posted") posted++;
      else pending++;
    });
    $("stat-total").textContent    = total;
    $("stat-approved").textContent = approved;
    $("stat-pending").textContent  = pending;
    $("stat-changes").textContent  = changes;
    var postedEl = $("stat-posted");
    if (postedEl) postedEl.textContent = posted;
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

    var mUrl = postMediaUrl(p);
    if (mUrl) {
      chip.appendChild(buildMedia(mUrl, postMediaType(p), { cls: "chip-media" }));
    }

    if (p.publish_at) {
      var when = document.createElement("span");
      when.className = "post-time";
      when.textContent = "🕒 " + formatPublishTime(p.publish_at);
      chip.appendChild(when);
    }

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
    el.style.backgroundImage = "";
    el.innerHTML = "";
    var url = postMediaUrl(p);
    if (url) {
      el.classList.add("has-media");
      el.appendChild(buildMedia(url, postMediaType(p), { controls: true, alt: p.caption || "" }));
    } else {
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

    var dateLine = formatLongDate(p.date);
    if (p.publish_at) dateLine += "  ·  Publishes " + formatPublishAt(p.publish_at);
    $("modal-date").textContent = dateLine;
    $("modal-caption").textContent = p.caption;
    $("modal-notes").value = p.reviewer_notes || "";

    $("modal-overlay").hidden = false;
    $("modal-notes").focus();
  }
  function closeReview() {
    $("modal-overlay").hidden = true;
    activeId = null;
  }

  function submitReview(status) {
    if (!activeId) return;
    applyReview(activeId, status, $("modal-notes").value.trim(),
      [$("btn-approve"), $("btn-request-changes")]);
  }

  // Shared by the desktop review modal and the mobile review cards.
  async function applyReview(postId, status, notes, buttons) {
    buttons.forEach(function (b) { b.disabled = true; });
    try {
      var res = await db.rpc("submit_review", {
        p_token: reviewToken,
        p_post_id: postId,
        p_status: status,
        p_notes: notes
      });
      if (res.error) throw res.error;
      var p = getPost(postId);
      if (p) { p.status = status; p.reviewer_notes = notes; }
      renderSummary();
      renderCalendar();
      renderReviewList();
      if (activeId === postId) closeReview();
    } catch (err) {
      alert("Could not save your review: " + (err.message || err));
    } finally {
      buttons.forEach(function (b) { b.disabled = false; });
    }
  }

  /* ---------------- Client review: mobile list ---------------- */
  function renderReviewList() {
    var host = $("review-list");
    if (!host) return;
    host.innerHTML = "";
    if (MODE !== "client") return;
    if (!posts.length) {
      host.innerHTML = '<p class="review-empty">No posts to review yet.</p>';
      return;
    }
    var byDate = {};
    posts.forEach(function (p) { (byDate[p.date] = byDate[p.date] || []).push(p); });

    Object.keys(byDate).sort().forEach(function (key) {
      var group = document.createElement("section");
      group.className = "review-group";
      var h = document.createElement("h3");
      h.className = "review-group-date";
      h.textContent = formatLongDate(key);
      group.appendChild(h);
      byDate[key].forEach(function (p) { group.appendChild(buildReviewCard(p)); });
      host.appendChild(group);
    });
  }

  function buildReviewCard(p) {
    var card = document.createElement("article");
    card.className = "review-card platform-" + p.platform;

    var url = postMediaUrl(p);
    if (url) {
      card.appendChild(buildMedia(url, postMediaType(p),
        { controls: true, cls: "review-card-media", alt: p.caption || "" }));
    }

    var meta = document.createElement("div");
    meta.className = "review-card-meta";
    var plat = document.createElement("span");
    plat.className = "platform-tag platform-" + p.platform;
    plat.textContent = (PLATFORMS[p.platform] || {}).label || p.platform;
    meta.appendChild(plat);
    var type = document.createElement("span");
    type.className = "type-tag";
    type.textContent = p.post_type;
    meta.appendChild(type);
    var st = STATUSES[p.status] || STATUSES.pending;
    var pill = document.createElement("span");
    pill.className = "status-pill " + st.cls;
    pill.textContent = st.label;
    meta.appendChild(pill);
    card.appendChild(meta);

    if (p.publish_at) {
      var when = document.createElement("p");
      when.className = "review-card-when";
      when.textContent = "🕒 Publishes " + formatPublishAt(p.publish_at);
      card.appendChild(when);
    }

    if (p.caption) {
      var cap = document.createElement("p");
      cap.className = "review-card-caption";
      cap.textContent = p.caption;
      card.appendChild(cap);
    }

    var lbl = document.createElement("label");
    lbl.className = "notes-label";
    lbl.setAttribute("for", "rc-notes-" + p.id);
    lbl.textContent = "Reviewer notes";
    card.appendChild(lbl);
    var ta = document.createElement("textarea");
    ta.className = "notes-input";
    ta.id = "rc-notes-" + p.id;
    ta.rows = 2;
    ta.placeholder = "Add notes (optional for approvals, helpful for changes)…";
    ta.value = p.reviewer_notes || "";
    card.appendChild(ta);

    var actions = document.createElement("div");
    actions.className = "modal-actions";
    var changesBtn = document.createElement("button");
    changesBtn.type = "button";
    changesBtn.className = "btn btn-changes";
    changesBtn.textContent = "Request Changes";
    var approveBtn = document.createElement("button");
    approveBtn.type = "button";
    approveBtn.className = "btn btn-approve";
    approveBtn.textContent = "Approve";
    changesBtn.addEventListener("click", function () {
      applyReview(p.id, "changes_requested", ta.value.trim(), [approveBtn, changesBtn]);
    });
    approveBtn.addEventListener("click", function () {
      applyReview(p.id, "approved", ta.value.trim(), [approveBtn, changesBtn]);
    });
    actions.appendChild(changesBtn);
    actions.appendChild(approveBtn);
    card.appendChild(actions);

    return card;
  }

  /* ---------------- Admin: post editor ---------------- */
  function openEditor(id, presetDate) {
    editingId = id || null;
    var p = id ? getPost(id) : null;

    $("editor-title").textContent = p ? "Edit post" : "Add post";
    $("f-date").value     = p ? p.date : (presetDate || dateKey(new Date()));
    $("f-platform").value = p ? p.platform : "linkedin";
    $("f-type").value     = p ? p.post_type : "Photo";
    $("f-caption").value  = p ? p.caption : "";
    $("f-publish").value  = p ? isoToLocalInput(p.publish_at) : "";
    if ($("f-status")) $("f-status").value = p ? p.status : "pending";
    $("editor-delete").hidden = !p;

    // Reset media controls, then show any existing media as a preview.
    pendingFile = null;
    $("f-image").value = "";
    $("f-file").value = "";
    existingMediaUrl  = p ? (postMediaUrl(p) || null) : null;
    existingMediaType = p ? (postMediaType(p) || null) : null;
    hideUploadProgress();
    if (existingMediaUrl) showDropzonePreview(existingMediaUrl, existingMediaType, false);
    else clearDropzonePreview();

    $("editor-overlay").hidden = false;
    $("f-caption").focus();
  }
  function closeEditor() {
    $("editor-overlay").hidden = true;
    editingId = null;
    pendingFile = null;
    clearDropzonePreview();
  }

  /* ---------------- Admin: media picker (drag & drop + upload) ---------------- */
  function onFileChosen(file) {
    if (!file) return;
    if (!isAcceptedMedia(file)) {
      alert("Please choose an image (JPG, PNG, WEBP, GIF) or a video (MP4, MOV, WEBM).");
      return;
    }
    pendingFile = file;
    existingMediaUrl = existingMediaType = null;  // a new file supersedes existing media
    $("f-image").value = "";
    showDropzonePreview(URL.createObjectURL(file), mediaTypeForFile(file), true);
  }

  function onUrlInput() {
    if (pendingFile) return;            // a picked file takes precedence
    var v = $("f-image").value.trim();
    if (v) {
      existingMediaUrl = existingMediaType = null;
      showDropzonePreview(v, mediaTypeForUrl(v), false);
    } else if (!existingMediaUrl) {
      clearDropzonePreview();
    }
  }

  function showDropzonePreview(url, type, isObjectUrl) {
    var prev = $("dropzone-preview");
    prev.innerHTML = "";
    var el;
    if (type === "video") {
      el = document.createElement("video");
      el.src = url; el.controls = true; el.preload = "metadata"; el.playsInline = true;
    } else {
      el = document.createElement("img");
      el.src = url; el.alt = "Selected media preview";
    }
    prev.appendChild(el);
    prev.hidden = false;
    $("dropzone-empty").hidden = true;
    $("dropzone-remove").hidden = false;
    if (lastObjectUrl && lastObjectUrl !== url) URL.revokeObjectURL(lastObjectUrl);
    lastObjectUrl = isObjectUrl ? url : null;
  }

  function clearDropzonePreview() {
    var prev = $("dropzone-preview");
    if (prev) { prev.innerHTML = ""; prev.hidden = true; }
    if ($("dropzone-empty")) $("dropzone-empty").hidden = false;
    if ($("dropzone-remove")) $("dropzone-remove").hidden = true;
    if (lastObjectUrl) { URL.revokeObjectURL(lastObjectUrl); lastObjectUrl = null; }
  }

  function removeMedia() {
    pendingFile = null;
    existingMediaUrl = existingMediaType = null;
    $("f-image").value = "";
    $("f-file").value = "";
    clearDropzonePreview();
  }

  function showUploadProgress(frac) {
    $("upload-progress").hidden = false;
    var pct = Math.round((frac || 0) * 100);
    $("upload-bar-fill").style.width = pct + "%";
    $("upload-pct").textContent = "Uploading… " + pct + "%";
  }
  function hideUploadProgress() {
    $("upload-progress").hidden = true;
    $("upload-bar-fill").style.width = "0%";
  }

  // Upload to the public "post-media" bucket via the Storage REST endpoint so
  // we get real upload progress (the JS client's .upload() doesn't expose it).
  async function uploadMedia(file, onProgress) {
    var ext  = extOf(file.name) || (mediaTypeForFile(file) === "video" ? "mp4" : "jpg");
    var rand = Math.random().toString(36).slice(2, 8);
    var path = (currentClientId || "shared") + "/" + Date.now() + "-" + rand + "." + ext;

    var sess  = await db.auth.getSession();
    var token = sess && sess.data && sess.data.session
      ? sess.data.session.access_token : SUPABASE_ANON_KEY;

    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open("POST", SUPABASE_URL + "/storage/v1/object/post-media/" + path);
      xhr.setRequestHeader("Authorization", "Bearer " + token);
      xhr.setRequestHeader("apikey", SUPABASE_ANON_KEY);
      xhr.setRequestHeader("x-upsert", "true");
      if (file.type) xhr.setRequestHeader("Content-Type", file.type);
      xhr.upload.onprogress = function (e) {
        if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
      };
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(db.storage.from("post-media").getPublicUrl(path).data.publicUrl);
        } else {
          reject(new Error("Upload failed (" + xhr.status + "). " + (xhr.responseText || "")));
        }
      };
      xhr.onerror = function () { reject(new Error("Network error during upload.")); };
      xhr.send(file);
    });
  }

  async function saveEditor(e) {
    e.preventDefault();
    if (!currentClientId) { alert("Create or select a client first."); return; }
    if (!$("f-date").value) { alert("Please pick a date."); return; }

    var saveBtn = $("editor-save");
    saveBtn.disabled = true;
    try {
      // Resolve media: a freshly picked file uploads now; otherwise fall back
      // to a pasted URL, then to whatever the post already had.
      var mediaUrl = null, mediaType = null;
      if (pendingFile) {
        showUploadProgress(0);
        mediaUrl  = await uploadMedia(pendingFile, showUploadProgress);
        mediaType = mediaTypeForFile(pendingFile);
        hideUploadProgress();
      } else {
        var pasted = $("f-image").value.trim();
        if (pasted) {
          mediaUrl = pasted;
          mediaType = mediaTypeForUrl(pasted);
        } else if (existingMediaUrl) {
          mediaUrl = existingMediaUrl;
          mediaType = existingMediaType;
        }
      }

      var record = {
        client_id:  currentClientId,
        date:       $("f-date").value,
        publish_at: localInputToIso($("f-publish").value),
        platform:   $("f-platform").value,
        post_type:  $("f-type").value,
        caption:    $("f-caption").value.trim(),
        media_url:  mediaUrl,
        media_type: mediaUrl ? mediaType : null,
        // Keep the legacy column populated for images so older readers still work.
        image_url:  mediaType === "image" ? mediaUrl : null
      };
      if ($("f-status")) record.status = $("f-status").value;

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
      hideUploadProgress();
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

  /* ---------------- Admin: approved & scheduled queue ---------------- */
  // Switch the admin work area between the calendar and the posting queue.
  function setAdminView(v) {
    adminView = v;
    var isQueue = v === "queue";
    $("calendar-view").hidden = isQueue;
    $("queue-view").hidden = !isQueue;
    var tabCal = $("tab-calendar"), tabQ = $("tab-queue");
    if (tabCal) tabCal.classList.toggle("is-active", !isQueue);
    if (tabQ) tabQ.classList.toggle("is-active", isQueue);
    if (isQueue) renderQueue();
  }

  // The daily worksheet: every Approved (not yet Posted) post, soonest first.
  function renderQueue() {
    var host = $("queue-list");
    if (!host) return;
    host.innerHTML = "";

    var queued = posts.filter(function (p) { return p.status === "approved"; });
    queued.sort(function (a, b) {
      // Posts with a publish time come first (soonest → latest); undated last.
      var ta = a.publish_at ? new Date(a.publish_at).getTime() : Infinity;
      var tb = b.publish_at ? new Date(b.publish_at).getTime() : Infinity;
      if (ta !== tb) return ta - tb;
      return (a.date || "").localeCompare(b.date || "");
    });

    $("queue-count").textContent = queued.length +
      (queued.length === 1 ? " post ready to publish" : " posts ready to publish");

    if (!queued.length) {
      host.innerHTML = '<p class="queue-empty">No approved posts waiting. ' +
        'Once a client approves a post, it appears here as your posting worksheet.</p>';
      return;
    }

    queued.forEach(function (p) { host.appendChild(buildQueueCard(p)); });
  }

  function buildQueueCard(p) {
    var card = document.createElement("article");
    card.className = "queue-card platform-" + p.platform;

    // Media (image thumbnail or playable video)
    var url = postMediaUrl(p);
    var media = document.createElement("div");
    media.className = "queue-card-media";
    if (url) {
      media.appendChild(buildMedia(url, postMediaType(p), { controls: true, alt: p.caption || "" }));
    } else {
      media.classList.add("is-empty");
      media.textContent = "No media";
    }
    card.appendChild(media);

    // Body
    var body = document.createElement("div");
    body.className = "queue-card-body";

    var meta = document.createElement("div");
    meta.className = "queue-card-meta";
    var plat = document.createElement("span");
    plat.className = "platform-tag platform-" + p.platform;
    plat.textContent = (PLATFORMS[p.platform] || {}).label || p.platform;
    meta.appendChild(plat);
    var type = document.createElement("span");
    type.className = "type-tag";
    type.textContent = p.post_type;
    meta.appendChild(type);
    body.appendChild(meta);

    var when = document.createElement("p");
    when.className = "queue-card-when";
    when.textContent = p.publish_at
      ? "🕒 " + formatPublishAt(p.publish_at)
      : "🕒 No publish time set · " + formatLongDate(p.date);
    body.appendChild(when);

    var cap = document.createElement("p");
    cap.className = "queue-card-caption";
    cap.textContent = p.caption || "(no caption)";
    body.appendChild(cap);

    // Actions
    var actions = document.createElement("div");
    actions.className = "queue-card-actions";

    var copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "ghost-btn queue-btn";
    copyBtn.textContent = "Copy caption";
    copyBtn.addEventListener("click", function () { copyCaption(p, copyBtn); });
    actions.appendChild(copyBtn);

    var dlBtn = document.createElement("button");
    dlBtn.type = "button";
    dlBtn.className = "ghost-btn queue-btn";
    dlBtn.textContent = "Download media";
    dlBtn.disabled = !url;
    if (url) dlBtn.addEventListener("click", function () { downloadMedia(p, dlBtn); });
    actions.appendChild(dlBtn);

    var postedBtn = document.createElement("button");
    postedBtn.type = "button";
    postedBtn.className = "primary-btn queue-btn queue-btn-posted";
    postedBtn.textContent = "Mark as Posted";
    postedBtn.addEventListener("click", function () { markPosted(p, postedBtn); });
    actions.appendChild(postedBtn);

    body.appendChild(actions);
    card.appendChild(body);
    return card;
  }

  function copyCaption(p, btn) {
    var text = p.caption || "";
    var done = function () {
      var orig = btn.textContent;
      btn.textContent = "Copied ✓";
      setTimeout(function () { btn.textContent = orig; }, 1800);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { window.prompt("Copy caption:", text); });
    } else {
      window.prompt("Copy caption:", text);
    }
  }

  // Fetch the media as a blob so the browser downloads (not navigates to) it.
  async function downloadMedia(p, btn) {
    var url = postMediaUrl(p);
    if (!url) return;
    var orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Downloading…";
    try {
      var resp = await fetch(url);
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      var blob = await resp.blob();
      var objUrl = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = objUrl;
      a.download = filenameFor(p, url);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(objUrl); }, 4000);
      btn.textContent = "Downloaded ✓";
    } catch (err) {
      // Fall back to opening in a new tab if a cross-origin fetch is blocked.
      window.open(url, "_blank");
      btn.textContent = "Opened ↗";
    } finally {
      setTimeout(function () { btn.textContent = orig; btn.disabled = false; }, 1800);
    }
  }

  function filenameFor(p, url) {
    var ext = extOf(url) || (postMediaType(p) === "video" ? "mp4" : "jpg");
    var slug = (p.platform || "post") + "-" + (p.date || "");
    return slug.replace(/[^a-z0-9-]/gi, "") + "." + ext;
  }

  async function markPosted(p, btn) {
    if (!window.confirm("Mark this post as Posted? It will leave the queue.")) return;
    btn.disabled = true;
    var orig = btn.textContent;
    btn.textContent = "Saving…";
    try {
      var res = await db.from("posts").update({ status: "posted" }).eq("id", p.id);
      if (res.error) throw res.error;
      p.status = "posted";
      renderSummary();
      renderCalendar();
      renderQueue();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = orig;
      alert("Could not mark as posted: " + (err.message || err));
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
    if (adminView === "queue") renderQueue();
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
    $("view-tabs").hidden = false;
    setAdminView("calendar");
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
    $("view-tabs").hidden = true;
    setAdminView("calendar");
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
    renderReviewList();
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

    $("tab-calendar").addEventListener("click", function () { setAdminView("calendar"); });
    $("tab-queue").addEventListener("click", function () { setAdminView("queue"); });

    $("editor-close").addEventListener("click", closeEditor);
    $("editor-overlay").addEventListener("click", function (e) { if (e.target === this) closeEditor(); });
    $("editor-form").addEventListener("submit", saveEditor);
    $("editor-delete").addEventListener("click", deletePost);

    // Media picker: click-to-browse, drag & drop, paste-URL, remove.
    var dz = $("dropzone");
    dz.addEventListener("click", function (e) {
      if (e.target.id === "dropzone-remove") return;
      $("f-file").click();
    });
    dz.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("f-file").click(); }
    });
    $("f-file").addEventListener("change", function () {
      if (this.files && this.files[0]) onFileChosen(this.files[0]);
    });
    ["dragenter", "dragover"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add("is-dragover"); });
    });
    ["dragleave", "dragend", "drop"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) {
        if (ev !== "drop" && e.target !== dz) return;
        dz.classList.remove("is-dragover");
      });
    });
    dz.addEventListener("drop", function (e) {
      e.preventDefault();
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) onFileChosen(f);
    });
    $("dropzone-remove").addEventListener("click", function (e) { e.stopPropagation(); removeMedia(); });
    $("f-image").addEventListener("input", onUrlInput);

    $("login-form").addEventListener("submit", handleLogin);
    $("login-close").addEventListener("click", function () { showLogin(false); });
    $("login-overlay").addEventListener("click", function (e) { if (e.target === this) showLogin(false); });
    $("signin-btn").addEventListener("click", function () { showLogin(true); });
    $("signout-btn").addEventListener("click", function () { db.auth.signOut(); });
  }

  /* ---------------- Init ---------------- */
  async function init() {
    document.body.classList.add("mode-" + MODE);
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
