/* ==========================================================================
   MCCIA Annual Awards — interactions
   Vanilla JS, no dependencies, progressive enhancement.
   ========================================================================== */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var ready = function (fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  };

  ready(function () {
    var header = document.querySelector(".site-header");
    var jumpbar = document.querySelector("[data-jumpbar]");
    var mobilebar = document.querySelector("[data-mobilebar]");
    var toTop = document.querySelector(".to-top");
    var progress = document.querySelector("[data-progress]");

    /* ---------- single scroll loop ---------- */
    var ticking = false;
    function frame() {
      var y = window.pageYOffset || document.documentElement.scrollTop;
      var docH = document.documentElement.scrollHeight - window.innerHeight;

      if (header) header.classList.toggle("is-stuck", y > 8);
      if (progress) progress.style.width = (docH > 0 ? clamp(y / docH, 0, 1) * 100 : 0) + "%";

      /* jump bar appears once the hero is behind us */
      if (jumpbar) {
        var hero = document.querySelector(".hero") || document.querySelector(".detail-hero");
        var trigger = hero ? Math.max(hero.offsetHeight - 120, 320) : 320;
        jumpbar.classList.toggle("is-visible", y > trigger);
      }
      /* mobile action bar */
      if (mobilebar) {
        var showAt = window.innerHeight * 0.9;
        var nearEnd = docH > 0 && y > docH - 260;
        mobilebar.classList.toggle("is-visible", y > showAt && !nearEnd);
      }
      if (toTop) toTop.classList.toggle("is-visible", y > 700);

      ticking = false;
    }
    function onScroll() {
      if (!ticking) { ticking = true; window.requestAnimationFrame(frame); }
    }
    frame();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    /* ---------- scroll-spy for jump bar + TOC ---------- */
    var spyTargets = [];
    var jumpLinks = {}, toclinks = {};
    document.querySelectorAll(".jumpbar__track a").forEach(function (a) {
      var id = (a.getAttribute("href") || "").replace("#", "");
      if (id) jumpLinks[id] = a;
    });
    document.querySelectorAll(".toc a").forEach(function (a) {
      var id = (a.getAttribute("href") || "").replace("#", "");
      if (id) toclinks[id] = a;
    });
    Object.keys(jumpLinks).forEach(function (id) { var el = document.getElementById(id); if (el) spyTargets.push(el); });
    Object.keys(toclinks).forEach(function (id) { var el = document.getElementById(id); if (el && spyTargets.indexOf(el) === -1) spyTargets.push(el); });

    if (spyTargets.length) {
      var setActive = function (id) {
        Object.keys(jumpLinks).forEach(function (k) {
          var on = k === id;
          jumpLinks[k].classList.toggle("is-active", on);
          if (on) jumpLinks[k].setAttribute("aria-current", "true"); else jumpLinks[k].removeAttribute("aria-current");
        });
        Object.keys(toclinks).forEach(function (k) { toclinks[k].classList.toggle("is-active", k === id); });
      };
      var spy = function () {
        var line = (header ? header.offsetHeight : 0) + (jumpbar && jumpbar.classList.contains("is-visible") ? jumpbar.offsetHeight : 0) + 24;
        var current = spyTargets[0];
        spyTargets.forEach(function (el) {
          if (el.getBoundingClientRect().top - line <= 8) current = el;
        });
        if (current) setActive(current.id);
      };
      var spyTick = false;
      window.addEventListener("scroll", function () {
        if (!spyTick) { spyTick = true; window.requestAnimationFrame(function () { spy(); spyTick = false; }); }
      }, { passive: true });
      spy();
    }

    /* ---------- mobile navigation ---------- */
    var toggle = document.querySelector(".nav-toggle");
    var mnav = document.getElementById("mobileNav");
    if (toggle && mnav) {
      toggle.addEventListener("click", function () {
        var open = mnav.classList.toggle("is-open");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      });
      mnav.addEventListener("click", function (e) {
        if (e.target.closest("a")) {
          mnav.classList.remove("is-open");
          toggle.setAttribute("aria-expanded", "false");
          toggle.setAttribute("aria-label", "Open menu");
        }
      });
    }

    /* ---------- active nav highlighting ---------- */
    var here = location.pathname.split("/").pop() || "index.html";
    document.querySelectorAll(".nav a, .mobile-nav a").forEach(function (a) {
      var href = a.getAttribute("href") || "";
      if (href.indexOf("#") > -1) return;
      if (href.split("/").pop() === here) { a.classList.add("is-active"); a.setAttribute("aria-current", "page"); }
    });

    /* ---------- countdown ---------- */
    var cd = document.querySelector("[data-countdown]");
    if (cd) {
      var target = Number(cd.getAttribute("data-countdown"));
      var parts = {
        d: cd.querySelector('[data-cd="d"]'), h: cd.querySelector('[data-cd="h"]'),
        m: cd.querySelector('[data-cd="m"]'), s: cd.querySelector('[data-cd="s"]')
      };
      var pad = function (n) { return String(n).padStart(2, "0"); };
      var timer = null;
      var tick = function () {
        if (!target || isNaN(target)) return;
        var diff = target - Date.now();
        if (diff <= 0) {
          cd.innerHTML = '<p style="grid-column:1/-1;margin:0;color:#fff;font-weight:600">Nominations for this cycle are now closed.</p>';
          if (timer) clearInterval(timer);
          return;
        }
        var sec = Math.floor(diff / 1000);
        if (parts.d) parts.d.textContent = Math.floor(sec / 86400);
        if (parts.h) parts.h.textContent = pad(Math.floor((sec % 86400) / 3600));
        if (parts.m) parts.m.textContent = pad(Math.floor((sec % 3600) / 60));
        if (parts.s) parts.s.textContent = pad(sec % 60);
      };
      tick();
      timer = setInterval(tick, 1000);
    }

    /* ---------- animated stat counters ---------- */
    var counters = document.querySelectorAll("[data-count]");
    if (counters.length) {
      var runCount = function (el) {
        var end = Number(el.getAttribute("data-count"));
        var suffix = el.getAttribute("data-suffix") || "";
        if (isNaN(end)) return;
        if (reduceMotion) { el.innerHTML = end + (suffix ? "<em>" + suffix + "</em>" : ""); return; }
        var start = performance.now(), dur = 1100;
        var step = function (now) {
          var p = clamp((now - start) / dur, 0, 1);
          var eased = 1 - Math.pow(1 - p, 3);
          var val = Math.round(end * eased);
          el.innerHTML = val + (suffix ? "<em>" + suffix + "</em>" : "");
          if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      };
      if ("IntersectionObserver" in window) {
        var cio = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) {
            if (en.isIntersecting) { runCount(en.target); cio.unobserve(en.target); }
          });
        }, { threshold: 0.5 });
        counters.forEach(function (c) { cio.observe(c); });
      } else {
        counters.forEach(runCount);
      }
    }

    /* ---------- award explorer: filter + search ---------- */
    var grid = document.querySelector("[data-awards-grid]");
    if (grid) {
      var cards = Array.prototype.slice.call(grid.querySelectorAll("[data-award]"));
      var chips = Array.prototype.slice.call(document.querySelectorAll("[data-filter]"));
      var search = document.querySelector("[data-award-search]");
      var empty = document.querySelector("[data-empty-state]");
      var counter = document.querySelector("[data-result-count]");
      var activeCat = "all";

      var apply = function () {
        var q = (search && search.value ? search.value : "").trim().toLowerCase();
        var shown = 0;
        cards.forEach(function (card) {
          var cats = (card.getAttribute("data-cat") || "").split(/\s+/);
          var hay = (card.getAttribute("data-search") || "").toLowerCase();
          var show = (activeCat === "all" || cats.indexOf(activeCat) > -1) && (!q || hay.indexOf(q) > -1);
          card.hidden = !show;
          if (show) shown++;
        });
        if (empty) empty.hidden = shown !== 0;
        if (counter) counter.innerHTML = "<strong>" + shown + "</strong> of 9 awards shown";
        /* reflect counts on the chips */
        chips.forEach(function (chip) {
          var cat = chip.getAttribute("data-filter");
          var n = cat === "all" ? cards.length : cards.filter(function (c) {
            return (c.getAttribute("data-cat") || "").split(/\s+/).indexOf(cat) > -1;
          }).length;
          var badge = chip.querySelector(".chip__count");
          if (!badge) { badge = document.createElement("span"); badge.className = "chip__count"; chip.appendChild(badge); }
          badge.textContent = n;
        });
      };

      chips.forEach(function (chip) {
        chip.addEventListener("click", function () {
          activeCat = chip.getAttribute("data-filter");
          chips.forEach(function (c) { c.setAttribute("aria-pressed", c === chip ? "true" : "false"); });
          apply();
        });
      });

      if (search) {
        var wrapEl = search.closest(".search") || search.parentElement;
        var clear = document.createElement("button");
        clear.type = "button";
        clear.className = "search__clear";
        clear.setAttribute("aria-label", "Clear search");
        clear.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
        wrapEl.appendChild(clear);
        var syncClear = function () { wrapEl.classList.toggle("has-value", !!search.value); };
        search.addEventListener("input", function () { apply(); syncClear(); });
        search.addEventListener("keydown", function (e) { if (e.key === "Escape") { search.value = ""; apply(); syncClear(); } });
        clear.addEventListener("click", function () { search.value = ""; apply(); syncClear(); search.focus(); });
        syncClear();
      }
      apply();
    }

    /* ---------- area cards drive the award filter ---------- */
    document.querySelectorAll("[data-area-filter]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var target = btn.getAttribute("data-area-filter");
        var chip = document.querySelector('[data-filter="' + target + '"]');
        if (chip) chip.click();
        var sec = document.getElementById("awards");
        if (sec) sec.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      });
    });

    /* ---------- winners tabs ---------- */
    var tablist = document.querySelector("[data-win-tabs]");
    if (tablist) {
      var tabs = Array.prototype.slice.call(tablist.querySelectorAll("[data-win-tab]"));
      var selectTab = function (tab) {
        tabs.forEach(function (t) {
          var on = t === tab;
          t.setAttribute("aria-selected", on ? "true" : "false");
          t.setAttribute("tabindex", on ? "0" : "-1");
          var panel = document.getElementById(t.getAttribute("aria-controls"));
          if (panel) panel.hidden = !on;
        });
        var id = (tab.getAttribute("aria-controls") || "").replace("win-", "");
        if (id) {
          var link = document.querySelector('.side-nav a[href="awards/' + id + '.html"], .side-nav a[href="' + id + '.html"]');
          if (link) { link.classList.add("is-current"); }
        }
      };
      tabs.forEach(function (tab, i) {
        tab.addEventListener("click", function () { selectTab(tab); });
        tab.addEventListener("keydown", function (e) {
          var next = null;
          if (e.key === "ArrowRight") next = tabs[(i + 1) % tabs.length];
          if (e.key === "ArrowLeft") next = tabs[(i - 1 + tabs.length) % tabs.length];
          if (e.key === "Home") next = tabs[0];
          if (e.key === "End") next = tabs[tabs.length - 1];
          if (next) { e.preventDefault(); selectTab(next); next.focus(); }
        });
      });
    }

    /* ---------- FAQ accordion ---------- */
    document.querySelectorAll(".faq__item").forEach(function (item) {
      var btn = item.querySelector(".faq__q");
      var panel = item.querySelector(".faq__a");
      if (!btn || !panel) return;
      btn.addEventListener("click", function () {
        var open = item.classList.contains("is-open");
        var parent = item.parentElement;
        if (parent) {
          parent.querySelectorAll(".faq__item.is-open").forEach(function (other) {
            if (other !== item) {
              other.classList.remove("is-open");
              var ob = other.querySelector(".faq__q"), op = other.querySelector(".faq__a");
              if (ob) ob.setAttribute("aria-expanded", "false");
              if (op) op.style.maxHeight = "0px";
            }
          });
        }
        item.classList.toggle("is-open", !open);
        btn.setAttribute("aria-expanded", open ? "false" : "true");
        panel.style.maxHeight = open ? "0px" : panel.scrollHeight + 40 + "px";
      });
    });
    var openByDefault = document.querySelector(".faq__item.is-open .faq__q");
    if (openByDefault) openByDefault.click();

    /* ---------- reveal on scroll ---------- */
    var reveals = document.querySelectorAll(".reveal");
    if (reveals.length) {
      if (reduceMotion || !("IntersectionObserver" in window)) {
        reveals.forEach(function (r) { r.classList.add("is-in"); });
      } else {
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) { entry.target.classList.add("is-in"); io.unobserve(entry.target); }
          });
        }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
        reveals.forEach(function (r) { io.observe(r); });
      }
    }

    /* ---------- back to top ---------- */
    if (toTop) {
      toTop.addEventListener("click", function () {
        window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
      });
    }

    /* ---------- footer year ---------- */
    document.querySelectorAll("[data-year]").forEach(function (n) { n.textContent = new Date().getFullYear(); });

    /* ---------- 1. Custom Interactive Cursor ---------- */
    var cursor = document.createElement('div');
    cursor.className = 'custom-cursor';
    document.body.appendChild(cursor);
    
    document.addEventListener('mousemove', function(e) {
      cursor.style.transform = 'translate3d(' + e.clientX + 'px, ' + e.clientY + 'px, 0)';
    });

    document.querySelectorAll('a, button, .btn, .card, [data-award]').forEach(function(el) {
      el.addEventListener('mouseenter', function() { cursor.classList.add('is-hovering'); });
      el.addEventListener('mouseleave', function() { cursor.classList.remove('is-hovering'); });
    });

    /* ---------- 2. Kinetic Typography ---------- */
    var heroTitle = document.querySelector('.hero h1');
    if (heroTitle && !reduceMotion) {
      window.addEventListener('scroll', function() {
        var y = window.pageYOffset;
        if (y < 600) {
          heroTitle.style.letterSpacing = (-0.015 + (y * 0.00005)) + 'em';
        }
      }, { passive: true });
    }

    /* ---------- 3. Spatial Storytelling (Horizontal Scroll) ---------- */
    var awardsSection = document.getElementById('awards');
    if (awardsSection && !reduceMotion) {
      var grid = awardsSection.querySelector('ul') || awardsSection.querySelector('.grid') || awardsSection.querySelector('div');
      if (grid) {
        window.addEventListener('scroll', function() {
          var rect = awardsSection.getBoundingClientRect();
          if (rect.top < window.innerHeight && rect.bottom > 0) {
            var scrollPercent = 1 - (rect.bottom / (window.innerHeight + rect.height));
            grid.style.transform = 'translate3d(' + (-scrollPercent * 60) + 'px, 0, 0)';
          }
        }, { passive: true });
      }
    }

    /* ---------- 4. Ambient Fluid Background ---------- */
    var ambientBg = document.createElement('div');
    ambientBg.className = 'ambient-bg';
    document.body.appendChild(ambientBg);
    
    if (!reduceMotion) {
      document.addEventListener('mousemove', function(e) {
        var x = (e.clientX / window.innerWidth) * 100;
        var y = (e.clientY / window.innerHeight) * 100;
        ambientBg.style.background = 'radial-gradient(circle at ' + x + '% ' + y + '%, rgba(10, 108, 174, 0.08), transparent 40%), radial-gradient(circle at ' + (100 - x) + '% ' + (100 - y) + '%, rgba(10, 125, 61, 0.05), transparent 40%)';
      });
    }

    /* ---------- 5. Dynamic Accordion for Awards ---------- */
    var awardCards = document.querySelectorAll('.award-card');
    if (awardCards.length > 0) {
      document.querySelector('.awards-grid').classList.add('is-accordion-layout');
      
      awardCards.forEach(function(card) {
        card.classList.add('accordion-mode');
        
        var header = document.createElement('div');
        header.className = 'accordion-header';
        
        var top = card.querySelector('.award-card__top');
        var h3 = card.querySelector('h3');
        if (top && h3) {
          header.appendChild(top);
          header.appendChild(h3);
          
          var toggleIcon = document.createElement('span');
          toggleIcon.className = 'accordion-toggle';
          toggleIcon.innerHTML = '+';
          header.appendChild(toggleIcon);
          
          card.insertBefore(header, card.firstChild);
        }
        
        var body = document.createElement('div');
        body.className = 'accordion-body';
        
        // Move remaining content to body (skip header which is now index 0)
        while (card.childNodes.length > 1) {
          body.appendChild(card.childNodes[1]);
        }
        card.appendChild(body);
        
        header.addEventListener('click', function() {
          var isActive = card.classList.contains('is-active');
          
          // Close all
          awardCards.forEach(function(c) { 
            c.classList.remove('is-active'); 
            var t = c.querySelector('.accordion-toggle');
            if (t) t.innerHTML = '+';
          });
          
          // Open clicked if it wasn't already open
          if (!isActive) {
            card.classList.add('is-active');
            toggleIcon.innerHTML = '−'; // minus sign
            // Smooth scroll into view
            setTimeout(function() {
              card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 300);
          }
        });
      });
    }

  });
})();
