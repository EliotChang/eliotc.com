/* Sonder's compact media controls. No framework or third-party runtime. */
(() => {
  'use strict';

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const motionButtons = [...document.querySelectorAll('.sonder-motion-toggle')];
  const loops = [];
  let paused = motionQuery.matches;
  let generation = 0;
  let globe = null;

  function updateMotion() {
    motionButtons.forEach(button => {
      button.innerHTML = `<span aria-hidden="true">${paused ? '▶' : 'Ⅱ'}</span> ${paused ? 'Play motion' : 'Pause motion'}`;
    });
    loops.forEach(loop => {
      loop.update();
      if (paused) loop.expandedVideo.pause();
    });
    globe?.update();
  }
  motionButtons.forEach(button => button.addEventListener('click', () => {
    paused = !paused;
    generation += 1;
    updateMotion();
  }));
  motionQuery.addEventListener('change', () => {
    paused = motionQuery.matches;
    generation += 1;
    updateMotion();
  });

  // Fix the page in place while a native dialog is open. Overflow alone permits
  // background scrolling in Safari. Restore position and preexisting styles.
  let activeLocks = 0;
  let restorePage = null;
  function temporaryStyles(style, changes) {
    const previous = Object.keys(changes).map(property => ({
      property, value: style.getPropertyValue(property), priority: style.getPropertyPriority(property),
    }));
    Object.entries(changes).forEach(([property, value]) => style.setProperty(property, value, 'important'));
    return () => previous.forEach(({ property, value, priority }) => {
      if (value) style.setProperty(property, value, priority);
      else style.removeProperty(property);
    });
  }
  function lockPageScroll() {
    if (activeLocks === 0) {
      const root = document.documentElement;
      const body = document.body;
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;
      const width = body.getBoundingClientRect().width;
      const restoreScrollBehavior = temporaryStyles(root.style, { 'scroll-behavior': 'auto' });
      const restoreRoot = temporaryStyles(root.style, { overflow: 'hidden', 'overscroll-behavior': 'none' });
      const restoreBody = temporaryStyles(body.style, {
        position: 'fixed', top: `${-scrollY}px`, left: `${-scrollX}px`, right: 'auto', bottom: 'auto',
        width: `${width}px`, 'box-sizing': 'border-box', overflow: 'hidden', 'overscroll-behavior': 'none',
      });
      restorePage = () => {
        restoreBody();
        restoreRoot();
        window.scrollTo({ left: scrollX, top: scrollY, behavior: 'instant' });
        restoreScrollBehavior();
      };
    }
    activeLocks += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      activeLocks -= 1;
      if (activeLocks === 0) {
        restorePage?.();
        restorePage = null;
      }
    };
  }

  const dialogs = new Map();
  document.querySelectorAll('.sonder-lightbox').forEach(dialog => {
    let unlock = null;
    const release = () => { unlock?.(); unlock = null; };
    const close = () => { dialog.close(); release(); };
    const open = () => {
      if (dialog.open) return;
      unlock = lockPageScroll();
      try { dialog.showModal(); }
      catch (error) { release(); throw error; }
    };
    dialog.querySelector('.sonder-lightbox-close').addEventListener('click', close);
    dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('close', release);
    dialogs.set(dialog.id, { element: dialog, open, close });
  });
  document.querySelectorAll('button.sonder-image').forEach(button => {
    button.addEventListener('click', () => dialogs.get(button.dataset.dialog).open());
  });

  document.querySelectorAll('[data-loop]').forEach(element => {
    const video = element.querySelector('[data-inline]');
    const playButton = element.querySelector('[data-play]');
    const expandButton = element.querySelector('[data-expand]');
    const dialog = dialogs.get(element.dataset.dialog);
    const expandedVideo = dialog.element.querySelector('video');
    const label = video.getAttribute('aria-label');
    let visible = false;
    let expanded = false;
    let userPaused = false;
    let manualPlay = null;
    video.defaultMuted = true;
    video.muted = true;
    const update = () => {
      const allowed = manualPlay?.generation === generation ? manualPlay.enabled : !paused && !userPaused;
      if (visible && allowed && !expanded && !document.hidden) video.play().catch(() => {});
      else video.pause();
      if (document.hidden) expandedVideo.pause();
    };
    const updateLabel = () => {
      const playing = !video.paused;
      playButton.innerHTML = `<span aria-hidden="true">${playing ? 'Ⅱ' : '▶'}</span> ${playing ? 'Pause' : 'Play'}`;
      playButton.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} ${label}`);
    };
    video.addEventListener('play', updateLabel);
    video.addEventListener('pause', updateLabel);
    playButton.addEventListener('click', () => {
      userPaused = !video.paused;
      manualPlay = { generation, enabled: !userPaused };
      update();
    });
    expandButton.addEventListener('click', () => {
      expanded = true;
      video.pause();
      dialog.open();
      expandedVideo.defaultMuted = true;
      expandedVideo.muted = true;
      const startTime = video.currentTime;
      // Safari can defer seeking a preload=none video until metadata exists.
      if (expandedVideo.readyState >= 1) expandedVideo.currentTime = startTime;
      else expandedVideo.addEventListener('loadedmetadata', () => { expandedVideo.currentTime = startTime; }, { once: true });
      expandedVideo.play().catch(() => {});
    });
    dialog.element.addEventListener('close', () => {
      expandedVideo.pause();
      expanded = false;
      update();
    });
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting && entry.intersectionRatio >= 0.2;
      update();
    }, { threshold: 0.2 });
    observer.observe(video);
    document.addEventListener('visibilitychange', update);
    loops.push({ update, expandedVideo });
    updateLabel();
  });

  // The same chapter state drives desktop contents, tablet links and the mobile
  // native selector. Keep the active horizontal link inside its scroll container.
  const chapterSelect = document.querySelector('.sonder-chapter-select');
  const chapterLinks = document.querySelector('.sonder-chapter-links');
  const sections = [...chapterSelect.options].map(option => document.getElementById(option.value));
  const navLinks = [...document.querySelectorAll('.sonder-chapter-links a, .sonder-toc a')];
  let chapterFrame = 0;
  let activeChapter = '';
  function updateChapter() {
    chapterFrame = 0;
    if (activeLocks) return;
    const passed = sections.filter(section => section.getBoundingClientRect().top <= window.innerHeight * 0.33);
    const id = (passed.at(-1) || sections[0]).id;
    chapterSelect.value = id;
    if (id === activeChapter) return;
    activeChapter = id;
    navLinks.forEach(link => {
      if (link.hash === `#${id}`) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
    const current = chapterLinks.querySelector('[aria-current="location"]');
    if (current && chapterLinks.clientWidth) {
      const left = current.offsetLeft - chapterLinks.offsetLeft;
      if (left < chapterLinks.scrollLeft) chapterLinks.scrollLeft = left;
      else if (left + current.offsetWidth > chapterLinks.scrollLeft + chapterLinks.clientWidth) {
        chapterLinks.scrollLeft = left + current.offsetWidth - chapterLinks.clientWidth;
      }
    }
  }
  function scheduleChapter() {
    if (!chapterFrame) chapterFrame = requestAnimationFrame(updateChapter);
  }
  window.addEventListener('scroll', scheduleChapter, { passive: true });
  window.addEventListener('resize', scheduleChapter);
  chapterSelect.addEventListener('change', () => { window.location.hash = chapterSelect.value; });
  updateChapter();

  // An interactive reconstruction using Sonder's original Earth texture. The
  // inverse orthographic projection retains visible land and needs no 3D library.
  const canvas = document.querySelector('.sonder-globe canvas');
  const context = canvas.getContext('2d', { alpha: true });
  const status = document.querySelector('.sonder-globe [role="status"]');
  const controls = [...document.querySelectorAll('.sonder-globe-controls button')];
  if (context) {
    const SIZE = 480;
    const TEXTURE_WIDTH = 2048;
    const TEXTURE_HEIGHT = 1024;
    const TAU = Math.PI * 2;
    let visible = false;
    let frame = 0;
    let lastTime = 0;
    let texture = null;
    let longitude = -32 * Math.PI / 180;
    let userPaused = false;
    let manualPlay = null;
    let pointer = null;
    const output = context.createImageData(SIZE, SIZE);
    const pixels = SIZE * SIZE;
    const uMap = new Float32Array(pixels);
    const vMap = new Float32Array(pixels);
    const light = new Float32Array(pixels);
    const radius = SIZE * 0.447;
    const latitude = 18 * Math.PI / 180;
    const sinLatitude = Math.sin(latitude);
    const cosLatitude = Math.cos(latitude);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const index = y * SIZE + x;
        const dx = (x + 0.5 - SIZE / 2) / radius;
        const dy = (SIZE / 2 - y - 0.5) / radius;
        const rhoSquared = dx * dx + dy * dy;
        if (rhoSquared >= 1) continue;
        const z = Math.sqrt(1 - rhoSquared);
        const lat = Math.asin(z * sinLatitude + dy * cosLatitude);
        const lon = Math.atan2(dx, z * cosLatitude - dy * sinLatitude);
        uMap[index] = ((lon + Math.PI) / TAU) * TEXTURE_WIDTH;
        vMap[index] = ((Math.PI / 2 - lat) / Math.PI) * (TEXTURE_HEIGHT - 1);
        light[index] = 1.18 * (0.76 + 0.24 * z);
        output.data[index * 4 + 3] = Math.min(255, (1 - Math.sqrt(rhoSquared)) * radius * 255);
      }
    }
    function draw() {
      if (!texture) return;
      const offset = longitude / TAU * TEXTURE_WIDTH;
      const result = output.data;
      for (let index = 0; index < pixels; index++) {
        if (light[index] === 0) continue;
        const u = ((uMap[index] + offset) % TEXTURE_WIDTH + TEXTURE_WIDTH) % TEXTURE_WIDTH;
        const v = vMap[index];
        const x0 = Math.floor(u);
        const x1 = (x0 + 1) % TEXTURE_WIDTH;
        const y0 = Math.floor(v);
        const y1 = Math.min(TEXTURE_HEIGHT - 1, y0 + 1);
        const fx = u - x0;
        const fy = v - y0;
        const a = (y0 * TEXTURE_WIDTH + x0) * 4;
        const b = (y0 * TEXTURE_WIDTH + x1) * 4;
        const c = (y1 * TEXTURE_WIDTH + x0) * 4;
        const d = (y1 * TEXTURE_WIDTH + x1) * 4;
        const target = index * 4;
        for (let channel = 0; channel < 3; channel++) {
          const top = texture[a + channel] * (1 - fx) + texture[b + channel] * fx;
          const bottom = texture[c + channel] * (1 - fx) + texture[d + channel] * fx;
          result[target + channel] = (top * (1 - fy) + bottom * fy) * light[index];
        }
      }
      context.putImageData(output, 0, 0);
    }
    function playing() { return !userPaused && (!paused || manualPlay === generation); }
    function tick(time) {
      frame = 0;
      if (!texture || !visible || !playing() || document.hidden) return;
      if (lastTime === 0) lastTime = time;
      const elapsed = time - lastTime;
      if (elapsed >= 1000 / 24) {
        longitude = (longitude + Math.min(elapsed, 100) * 0.000075) % TAU;
        lastTime = time;
        draw();
      }
      frame = requestAnimationFrame(tick);
    }
    function update() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      lastTime = 0;
      const enabled = playing();
      controls[1].textContent = enabled ? 'Pause rotation' : 'Rotate globe';
      controls[1].setAttribute('aria-label', enabled ? 'Pause globe rotation' : 'Play globe rotation');
      if (texture && visible && enabled && !document.hidden) frame = requestAnimationFrame(tick);
    }
    function rotate(amount) {
      userPaused = true;
      longitude = (longitude + amount) % TAU;
      draw();
      update();
    }
    function toggleRotation() {
      const wasPlaying = playing();
      userPaused = wasPlaying;
      manualPlay = wasPlaying ? null : generation;
      update();
    }
    controls[0].addEventListener('click', () => rotate(-0.3));
    controls[1].addEventListener('click', toggleRotation);
    controls[2].addEventListener('click', () => rotate(0.3));
    canvas.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        rotate(event.key === 'ArrowLeft' ? -0.22 : 0.22);
      } else if (event.key === ' ') { event.preventDefault(); toggleRotation(); }
    });
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary) return;
      pointer = { id: event.pointerId, x: event.clientX };
      canvas.setPointerCapture(event.pointerId);
      rotate(0);
    });
    canvas.addEventListener('pointermove', event => {
      if (!pointer || pointer.id !== event.pointerId) return;
      longitude = (longitude + (pointer.x - event.clientX) * 0.007) % TAU;
      draw();
      pointer.x = event.clientX;
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(name => canvas.addEventListener(name, () => { pointer = null; }));
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting && entry.intersectionRatio >= 0.1;
      update();
    }, { threshold: 0.1 });
    observer.observe(canvas);
    document.addEventListener('visibilitychange', update);
    function error() { status.textContent = 'The globe could not load. Please refresh to try again.'; }
    const source = new Image();
    source.onload = () => {
      try {
        const surface = document.createElement('canvas');
        surface.width = TEXTURE_WIDTH;
        surface.height = TEXTURE_HEIGHT;
        const surfaceContext = surface.getContext('2d', { willReadFrequently: true });
        if (!surfaceContext) throw new Error('Canvas unavailable');
        surfaceContext.drawImage(source, 0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
        texture = surfaceContext.getImageData(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT).data;
        draw();
        status.remove();
        controls.forEach(button => { button.disabled = false; });
        update();
      } catch { error(); }
    };
    source.onerror = error;
    source.src = 'assets/globe-earth.webp';
    globe = { update };
  } else {
    status.textContent = 'The globe could not load in this browser.';
  }
  updateMotion();
})();
