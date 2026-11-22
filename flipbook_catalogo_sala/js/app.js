(() => {
  'use strict';

  const PDF_TOTAL_PAGES = 46;
  const FLIP_TIME = 900;

  // Catálogo de sala, 46 páginas, emparejadas como el libro impreso: portada sola,
  // 2-3 … 44-45 y contraportada sola. El motor trabaja sin "tapas duras"
  // (showCover: false), porque deforma la última hoja; por eso se añaden dos hojas
  // en blanco que no existen en el PDF: una a la izquierda de la portada (índice 0,
  // nunca visible: la portada la anima .cover-sequence) y otra a la izquierda de
  // la contraportada, que en doble página se oculta y la contraportada se centra.
  const pageFile = (n) => `pages/page-${String(n).padStart(2, '0')}.webp`;
  const interior = Array.from({ length: PDF_TOTAL_PAGES - 1 }, (_, i) => i + 1); // 1…45
  const pageImages = ['pages/blank.webp', ...interior.map(pageFile), 'pages/blank.webp', pageFile(PDF_TOTAL_PAGES)];
  const sourcePageNumbers = [1, ...interior, PDF_TOTAL_PAGES - 1, PDF_TOTAL_PAGES];
  const BOOK_PAGE_COUNT = pageImages.length;      // 48
  const FIRST_INSIDE_INDEX = 2;                    // pág. 2
  const BACK_COVER_INDEX = BOOK_PAGE_COUNT - 1;    // pág. 46
  const BACK_BLANK_INDEX = BOOK_PAGE_COUNT - 2;

  const bookElement = document.getElementById('book');
  const stage = document.getElementById('stage');
  const coverSequence = document.getElementById('coverSequence');
  const coverCard = document.getElementById('coverCard');
  const loading = document.getElementById('loading');
  const loadingPercent = document.getElementById('loadingPercent');
  const pageCounter = document.getElementById('pageCounter');
  const prevButton = document.getElementById('prevButton');
  const nextButton = document.getElementById('nextButton');
  const fullscreenButton = document.getElementById('fullscreenButton');
  const zoomButton = document.getElementById('zoomButton');
  const zoomViewer = document.getElementById('zoomViewer');
  const zoomCanvas = document.getElementById('zoomCanvas');
  const zoomImage = document.getElementById('zoomImage');
  const zoomPageLabel = document.getElementById('zoomPageLabel');
  const zoomPercent = document.getElementById('zoomPercent');
  const zoomInButton = document.getElementById('zoomInButton');
  const zoomOutButton = document.getElementById('zoomOutButton');
  const zoomResetButton = document.getElementById('zoomResetButton');
  const zoomCloseButton = document.getElementById('zoomCloseButton');
  const gestureHint = document.getElementById('gestureHint');

  let pageFlip = null;
  let bookReady = false;
  let coverMode = true;
  let transitioning = false;
  let hintTimer = null;
  let animationFrame = null;
  let coverProgress = 0;
  let dragStartX = 0;
  let dragStartProgress = 0;
  let dragging = false;
  let pendingOpen = false;
  let zoomOpen = false;
  let zoomScale = 1;
  let zoomX = 0;
  let zoomY = 0;
  let zoomDrag = null;
  let pinchStart = null;
  const zoomPointers = new Map();

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const isPortrait = () => window.__flipbookForcePortrait === true || window.matchMedia('(max-width: 720px)').matches || pageFlip?.getOrientation() === 'portrait';

  function refreshDeviceMode() {
    window.__refreshFlipbookDeviceMode?.();
  }

  function setCoverProgress(progress) {
    coverProgress = clamp(progress, 0, 1);
    const pageSize = coverCard.offsetWidth || 600;
    const shift = coverProgress * pageSize * 0.5;
    const angle = coverProgress * -180;
    coverCard.style.setProperty('--cover-shift', `${shift}px`);
    coverCard.style.setProperty('--cover-angle', `${angle}deg`);
    coverSequence.style.setProperty('--spread-opacity', String(clamp(coverProgress * 1.8, 0, 1)));
  }

  function animateCover(target, duration, done) {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    const from = coverProgress;
    const started = performance.now();
    const distance = target - from;
    const easing = (t) => 1 - Math.pow(1 - t, 3);

    const tick = (now) => {
      const elapsed = now - started;
      const t = clamp(elapsed / duration, 0, 1);
      setCoverProgress(from + distance * easing(t));
      if (t < 1) {
        animationFrame = requestAnimationFrame(tick);
      } else {
        animationFrame = null;
        done?.();
      }
    };

    animationFrame = requestAnimationFrame(tick);
  }

  function firstContentPageIndex() {
    return FIRST_INSIDE_INDEX;
  }

  function lastBookIndex() {
    // En doble página el último pliego empieza en la hoja en blanco añadida.
    return isPortrait() ? BACK_COVER_INDEX : BACK_BLANK_INDEX;
  }

  function setLastPageLayout(index) {
    const isLastPage = !coverMode && !isPortrait() && index >= BACK_BLANK_INDEX;
    bookElement.classList.toggle('last-page-centered', isLastPage);
  }

  function updateInterface(index = 0) {
    if (coverMode) {
      pageCounter.textContent = `1 / ${PDF_TOTAL_PAGES}`;
      prevButton.disabled = true;
      nextButton.disabled = !bookReady || transitioning;
      return;
    }

    setLastPageLayout(index);
    const safeIndex = clamp(index, 0, BOOK_PAGE_COUNT - 1);
    const atEnd = index >= lastBookIndex();
    const current = atEnd ? PDF_TOTAL_PAGES : sourcePageNumbers[safeIndex];
    pageCounter.textContent = `${current} / ${PDF_TOTAL_PAGES}`;
    const atBeginning = index <= FIRST_INSIDE_INDEX;
    prevButton.disabled = transitioning ? true : false;
    nextButton.disabled = transitioning || atEnd;
    prevButton.dataset.closesCover = atBeginning ? 'true' : 'false';
  }

  function showGestureHint() {
    window.clearTimeout(hintTimer);
    gestureHint.classList.add('visible');
    hintTimer = window.setTimeout(() => gestureHint.classList.remove('visible'), 4200);
  }

  function preloadEssentialImages() {
    let loaded = 0;
    const essential = pageImages.slice(0, 3);
    return Promise.all(essential.map((url) => new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        loaded += 1;
        loadingPercent.textContent = `${Math.round((loaded / essential.length) * 100)}%`;
        resolve(url);
      };
      image.onerror = () => reject(new Error(`No se pudo cargar ${url}`));
      image.src = url;
    })));
  }

  function initializeBook() {
    if (!window.St?.PageFlip) throw new Error('No se ha cargado el motor de paso de página.');

    pageFlip = new St.PageFlip(bookElement, {
      width: 595,
      height: 842,
      size: 'stretch',
      minWidth: 260,
      maxWidth: 640,
      minHeight: 368,
      maxHeight: 905,
      drawShadow: true,
      flippingTime: FLIP_TIME,
      usePortrait: true,
      startPage: 0,
      autoSize: true,
      maxShadowOpacity: 0.48,
      showCover: false,
      mobileScrollSupport: false,
      swipeDistance: 25,
      useMouseEvents: true,
      disableFlipByClick: true
    });

    pageFlip.on('init', () => {
      bookReady = true;
      // El motor mide su lienzo al arrancar, con el libro aún oculto; con hojas
      // verticales esa primera medida sale corta. Se vuelve a medir ya maquetado.
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
      loading.classList.add('hidden');
      updateInterface(0);
      window.setTimeout(showGestureHint, 500);
      if (pendingOpen) {
        pendingOpen = false;
        openCover();
      }
    });

    let previousIndex = 0;
    pageFlip.on('flip', (event) => {
      const index = event.data;
      if (!coverMode && !transitioning) {
        // No dejar ver las hojas en blanco añadidas ni la portada dentro del motor.
        if (index < FIRST_INSIDE_INDEX) {
          pageFlip.turnToPage(FIRST_INSIDE_INDEX);
          return;
        }
        if (isPortrait() && index === BACK_BLANK_INDEX) {
          pageFlip.turnToPage(index > previousIndex ? BACK_COVER_INDEX : BACK_BLANK_INDEX - 1);
          return;
        }
      }
      previousIndex = index;
      if (!coverMode) updateInterface(index);
      gestureHint.classList.remove('visible');
    });

    pageFlip.on('changeOrientation', () => {
      if (!coverMode) {
        const index = pageFlip.getCurrentPageIndex();
        if (pageFlip.getOrientation() === 'portrait' && index === BACK_BLANK_INDEX) {
          pageFlip.turnToPage(BACK_COVER_INDEX);
        }
        updateInterface(pageFlip.getCurrentPageIndex());
      }
    });

    pageFlip.loadFromImages(pageImages);
  }

  function showLoadError(error) {
    console.error(error);
    loading.classList.remove('hidden');
    loading.innerHTML = '<div class="loading-text loading-error">No se ha podido preparar el libro. Comprueba que las carpetas “js” y “pages” se han subido completas.</div>';
    nextButton.disabled = true;
  }

  function openCover() {
    if (transitioning || !coverMode) return;
    if (!bookReady) {
      pendingOpen = true;
      loading.classList.remove('hidden');
      return;
    }

    transitioning = true;
    nextButton.disabled = true;
    coverSequence.classList.add('turning');
    gestureHint.classList.remove('visible');

    animateCover(1, FLIP_TIME, () => {
      pageFlip.turnToPage(firstContentPageIndex());
      bookElement.classList.add('visible');
      coverSequence.classList.add('hidden');
      coverSequence.classList.remove('turning');
      coverMode = false;
      transitioning = false;
      updateInterface(pageFlip.getCurrentPageIndex());
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    });
  }

  function closeCover() {
    if (transitioning || coverMode || !pageFlip) return;

    transitioning = true;
    bookElement.classList.remove('last-page-centered');
    coverSequence.classList.remove('hidden');
    coverSequence.classList.add('turning');
    setCoverProgress(1);

    requestAnimationFrame(() => {
      bookElement.classList.remove('visible');
      pageFlip.turnToPage(0);
      animateCover(0, FLIP_TIME, () => {
        coverSequence.classList.remove('turning');
        coverMode = true;
        transitioning = false;
        updateInterface(0);
        window.setTimeout(showGestureHint, 350);
      });
    });
  }

  function goNext() {
    if (coverMode) {
      openCover();
    } else if (!transitioning && pageFlip && pageFlip.getCurrentPageIndex() < lastBookIndex()) {
      pageFlip.flipNext('bottom');
    }
  }

  function flipPrevAnimated() {
    if (!pageFlip) return;

    // page-flip 2.x calcula la esquina izquierda fuera del lienzo. Usamos la
    // coordenada real del libro para conservar la animación en cualquier modo.
    const bounds = pageFlip.getBoundsRect();
    pageFlip.getFlipController().flip({
      x: bounds.left + 10,
      y: bounds.height - 2
    });
  }

  function goPrev() {
    if (coverMode || transitioning || !pageFlip) return;
    const index = pageFlip.getCurrentPageIndex();
    const returnsToCover = index <= FIRST_INSIDE_INDEX;
    if (returnsToCover) {
      closeCover();
    } else {
      // Antes de volver desde la contraportada restauramos el lienzo completo
      // para que la animación inversa conserve su geometría normal.
      bookElement.classList.remove('last-page-centered');
      requestAnimationFrame(flipPrevAnimated);
    }
  }

  prevButton.addEventListener('click', goPrev);
  nextButton.addEventListener('click', goNext);

  document.addEventListener('keydown', (event) => {
    if (zoomOpen) {
      if (event.key === 'Escape') closeZoom();
      if (event.key === '+' || event.key === '=') setZoom(zoomScale + 0.25);
      if (event.key === '-') setZoom(zoomScale - 0.25);
      return;
    }
    if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
      event.preventDefault();
      goNext();
    }
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
      event.preventDefault();
      goPrev();
    }
    if (event.key === 'Home') {
      event.preventDefault();
      if (!coverMode) closeCover();
    }
    if (event.key === 'End' && bookReady) {
      event.preventDefault();
      if (coverMode) {
        coverSequence.classList.add('hidden');
        setCoverProgress(1);
        coverMode = false;
        bookElement.classList.add('visible');
      }
      pageFlip.turnToPage(BACK_COVER_INDEX);
      updateInterface(pageFlip.getCurrentPageIndex());
    }
  });

  coverCard.addEventListener('pointerdown', (event) => {
    if (!coverMode || transitioning || !bookReady) return;
    dragging = true;
    dragStartX = event.clientX;
    dragStartProgress = coverProgress;
    coverCard.setPointerCapture(event.pointerId);
    coverSequence.classList.add('turning', 'dragging');
    gestureHint.classList.remove('visible');
    event.preventDefault();
  });

  coverCard.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const width = coverCard.offsetWidth || 600;
    const movedLeft = dragStartX - event.clientX;
    setCoverProgress(dragStartProgress + movedLeft / (width * 0.82));
    event.preventDefault();
  });

  function finishCoverDrag(event) {
    if (!dragging) return;
    dragging = false;
    try { coverCard.releasePointerCapture(event.pointerId); } catch (_) {}
    coverSequence.classList.remove('dragging');

    if (coverProgress >= 0.24) {
      transitioning = true;
      animateCover(1, Math.max(320, FLIP_TIME * (1 - coverProgress)), () => {
        pageFlip.turnToPage(firstContentPageIndex());
        bookElement.classList.add('visible');
        coverSequence.classList.add('hidden');
        coverSequence.classList.remove('turning');
        coverMode = false;
        transitioning = false;
        updateInterface(pageFlip.getCurrentPageIndex());
        requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
      });
    } else {
      animateCover(0, 320, () => coverSequence.classList.remove('turning'));
    }
  }

  coverCard.addEventListener('pointerup', finishCoverDrag);
  coverCard.addEventListener('pointercancel', finishCoverDrag);


  function currentZoomPageIndex() {
    if (coverMode || !pageFlip) return 0;
    const index = clamp(pageFlip.getCurrentPageIndex(), 0, BOOK_PAGE_COUNT - 1);
    // La lupa no abre las hojas en blanco añadidas.
    if (index >= BACK_BLANK_INDEX) return BACK_COVER_INDEX;
    return Math.max(index, FIRST_INSIDE_INDEX);
  }

  function clampZoomPan() {
    if (zoomScale <= 1 || !zoomImage.clientWidth || !zoomCanvas.clientWidth) {
      zoomX = 0;
      zoomY = 0;
      return;
    }
    const maxX = Math.max(0, (zoomImage.clientWidth * zoomScale - zoomCanvas.clientWidth + 28) / 2);
    const maxY = Math.max(0, (zoomImage.clientHeight * zoomScale - zoomCanvas.clientHeight + 28) / 2);
    zoomX = clamp(zoomX, -maxX, maxX);
    zoomY = clamp(zoomY, -maxY, maxY);
  }

  function renderZoom() {
    clampZoomPan();
    zoomImage.style.transform = `translate3d(${zoomX}px, ${zoomY}px, 0) scale(${zoomScale})`;
    zoomPercent.textContent = `${Math.round(zoomScale * 100)}%`;
    zoomOutButton.disabled = zoomScale <= 1.001;
    zoomInButton.disabled = zoomScale >= 4;
    zoomCanvas.classList.toggle('pannable', zoomScale > 1.001);
  }

  function setZoom(value) {
    zoomScale = clamp(Math.round(value * 100) / 100, 1, 4);
    if (zoomScale === 1) {
      zoomX = 0;
      zoomY = 0;
    }
    renderZoom();
  }

  function resetZoom() {
    zoomScale = 1;
    zoomX = 0;
    zoomY = 0;
    renderZoom();
  }

  function openZoom() {
    const index = currentZoomPageIndex();
    const sourceNumber = sourcePageNumbers[index];
    zoomImage.src = pageImages[index];
    zoomPageLabel.textContent = `Página ${sourceNumber} de ${PDF_TOTAL_PAGES}`;
    zoomViewer.classList.add('open');
    zoomViewer.setAttribute('aria-hidden', 'false');
    zoomOpen = true;
    gestureHint.classList.remove('visible');
    requestAnimationFrame(resetZoom);
    zoomCloseButton.focus({ preventScroll: true });
  }

  function closeZoom() {
    if (!zoomOpen) return;
    zoomViewer.classList.remove('open');
    zoomViewer.setAttribute('aria-hidden', 'true');
    zoomPointers.clear();
    zoomCanvas.classList.remove('dragging');
    zoomOpen = false;
    zoomButton.focus({ preventScroll: true });
  }

  zoomButton.addEventListener('click', openZoom);
  zoomCloseButton.addEventListener('click', closeZoom);
  zoomInButton.addEventListener('click', () => setZoom(zoomScale + 0.25));
  zoomOutButton.addEventListener('click', () => setZoom(zoomScale - 0.25));
  zoomResetButton.addEventListener('click', resetZoom);
  zoomCanvas.addEventListener('dblclick', () => setZoom(zoomScale > 1 ? 1 : 2));
  zoomCanvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    setZoom(zoomScale * (event.deltaY < 0 ? 1.16 : 0.86));
  }, { passive: false });

  const pointerDistance = () => {
    const points = [...zoomPointers.values()];
    if (points.length < 2) return 0;
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  };

  zoomCanvas.addEventListener('pointerdown', (event) => {
    zoomPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    zoomCanvas.setPointerCapture(event.pointerId);
    if (zoomPointers.size === 1) {
      zoomDrag = { x: event.clientX, y: event.clientY, originX: zoomX, originY: zoomY };
      zoomCanvas.classList.add('dragging');
    } else if (zoomPointers.size === 2) {
      pinchStart = { distance: pointerDistance(), scale: zoomScale };
      zoomDrag = null;
    }
  });

  zoomCanvas.addEventListener('pointermove', (event) => {
    if (!zoomPointers.has(event.pointerId)) return;
    zoomPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (zoomPointers.size >= 2 && pinchStart) {
      const distance = pointerDistance();
      if (pinchStart.distance > 0) setZoom(pinchStart.scale * distance / pinchStart.distance);
    } else if (zoomDrag && zoomScale > 1) {
      zoomX = zoomDrag.originX + event.clientX - zoomDrag.x;
      zoomY = zoomDrag.originY + event.clientY - zoomDrag.y;
      renderZoom();
    }
  });

  function endZoomPointer(event) {
    zoomPointers.delete(event.pointerId);
    try { zoomCanvas.releasePointerCapture(event.pointerId); } catch (_) {}
    if (zoomPointers.size < 2) pinchStart = null;
    if (zoomPointers.size === 0) {
      zoomDrag = null;
      zoomCanvas.classList.remove('dragging');
    } else {
      const remaining = [...zoomPointers.values()][0];
      zoomDrag = { x: remaining.x, y: remaining.y, originX: zoomX, originY: zoomY };
    }
  }

  zoomCanvas.addEventListener('pointerup', endZoomPointer);
  zoomCanvas.addEventListener('pointercancel', endZoomPointer);

  fullscreenButton.addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch (error) {
      console.warn('Pantalla completa no disponible:', error);
    }
  });

  // Pantalla completa automática con la primera interacción. Los navegadores
  // no permiten activarla al cargar la página: exigen un gesto del usuario.
  // Solo se intenta una vez; si la persona sale con Esc, se respeta.
  let autoFullscreenTried = false;
  const fullscreenSupported = () => Boolean(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  function autoFullscreen(event) {
    if (autoFullscreenTried) return;
    if (event.target?.closest?.('#fullscreenButton, a')) return;
    autoFullscreenTried = true;
    window.removeEventListener('pointerdown', autoFullscreen, true);
    window.removeEventListener('keydown', autoFullscreen, true);
    if (!fullscreenSupported() || document.fullscreenElement || document.webkitFullscreenElement) return;
    const root = document.documentElement;
    const request = root.requestFullscreen || root.webkitRequestFullscreen;
    try {
      const result = request.call(root);
      if (result?.catch) result.catch((error) => console.warn('Pantalla completa no disponible:', error));
    } catch (error) {
      console.warn('Pantalla completa no disponible:', error);
    }
  }
  window.addEventListener('pointerdown', autoFullscreen, true);
  window.addEventListener('keydown', autoFullscreen, true);

  document.addEventListener('fullscreenchange', () => {
    fullscreenButton.setAttribute('aria-label', document.fullscreenElement ? 'Salir de pantalla completa' : 'Pantalla completa');
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      refreshDeviceMode();
      if (pageFlip) {
        const currentIndex = pageFlip.getCurrentPageIndex();
        bookElement.classList.remove('last-page-centered');
        pageFlip.update();
        requestAnimationFrame(() => setLastPageLayout(currentIndex));
      }
      if (coverMode) setCoverProgress(0);
      if (zoomOpen) requestAnimationFrame(renderZoom);
    }, 180);
  }, { passive: true });

  stage.addEventListener('contextmenu', (event) => event.preventDefault());

  refreshDeviceMode();
  updateInterface(0);
  setCoverProgress(0);
  preloadEssentialImages().then(initializeBook).catch(showLoadError);
})();
