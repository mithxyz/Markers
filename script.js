class MusicCueApp {
    constructor() {
        this.audioContext = null;
        this.audioBuffer = null;
        this.audioElement = null;
        this.videoElement = null;
        this.canvas = null;
        this.ctx = null;
        this.cues = [];
        this.currentCueId = null;
        this.isPlaying = false;
        this.waveformData = null;
        this.isResizing = false;
        
        // Zoom and pan properties
        this.zoomLevel = 1;
        this.panOffset = 0;
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartPan = 0;
        this.draggedMarker = null;
        this.timePopup = null;
        
        // Settings
        this.settings = {
            pauseOnCuePopup: true,
            showCueNumbers: true,
            useFadeTimes: true,
            useMarkerColor: true,
            keepPlayheadInView: true,
            ma3Id: 101,
            ma3Trigger: 'Go+',
            ma3OverrideEnabled: false,
            ma3OverrideId: 101,
            ma3UseSeparateIds: false,
            ma3SeqId: 101,
            ma3TcId: 101,
            ma3PageId: 101
        };
        
        this.wasPlayingBeforePopup = false;
        this.useVideo = false; // Track if video is currently active
        this.importedBasename = 'cues';
        this.mediaBasename = 'cues';
        this.uploadedFile = null;
        this.highlightedCueId = null;
        
        this.initializeElements();
        this.setupEventListeners();
        this.loadSettings();
    }

    isMobileDevice() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
               ('ontouchstart' in window) || 
               (navigator.maxTouchPoints > 0);
    }

    initializeElements() {
        this.audioElement = document.getElementById('audioPlayer');
        this.videoElement = document.getElementById('videoPlayer');
        this.canvas = document.getElementById('waveformCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.timePopup = document.getElementById('timePopup');
        this.themeToggle = document.getElementById('themeToggle');
        
        console.log('Canvas element found:', this.canvas);
        console.log('Canvas context:', this.ctx);
        console.log('Time popup element found:', this.timePopup);
        
        // Test popup visibility
        if (this.timePopup) {
            this.timePopup.style.display = 'block';
            this.timePopup.textContent = 'Test Popup';
            this.timePopup.style.left = '50px';
            this.timePopup.style.top = '50px';
            console.log('Popup test - should be visible now');
            
            // Hide after 2 seconds
            setTimeout(() => {
                this.timePopup.style.display = 'none';
                console.log('Popup test - hidden');
            }, 2000);
        }
        
        // Set canvas size
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
        
        // Also try to resize after a short delay to ensure DOM is ready
        setTimeout(() => {
            this.resizeCanvas();
        }, 500);
        // Initialize theme from storage
        const savedTheme = localStorage.getItem('theme') || 'dark';
        this.applyTheme(savedTheme);
        
        // Update upload text for mobile devices
        this.updateUploadText();
    }

    resizeCanvas() {
        if (this.isResizing) return;
        this.isResizing = true;
        
        const container = this.canvas.parentElement;
        const rect = container.getBoundingClientRect();
        
        // Set canvas size to match container
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        
        // Also set CSS size to ensure proper display
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';
        
        console.log('Canvas resized to:', this.canvas.width, 'x', this.canvas.height);
        
        this.isResizing = false;
        
        if (this.waveformData) {
            this.drawWaveform();
        }
    }
    
    updateUploadText() {
        const uploadText = document.getElementById('uploadText');
        if (uploadText) {
            if (this.isMobileDevice()) {
                uploadText.textContent = 'Tap here to select an audio file from your device';
            } else {
                uploadText.textContent = 'Drag and drop your audio file here or click to browse';
            }
        }
    }
    
    resizeCanvasOnly() {
        if (this.isResizing) return;
        this.isResizing = true;
        
        const container = this.canvas.parentElement;
        const rect = container.getBoundingClientRect();
        
        // Set canvas size to match container
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        
        // Also set CSS size to ensure proper display
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';
        
        console.log('Canvas resized to (no redraw):', this.canvas.width, 'x', this.canvas.height);
        
        this.isResizing = false;
    }

    // Highlight marker on timeline when hovering over cue in list
    highlightMarker(cueId) {
        this.highlightedCueId = cueId;
        this.drawWaveform(); // Redraw to show highlight
    }

    // Remove highlight from marker
    unhighlightMarker(cueId) {
        this.highlightedCueId = null;
        this.drawWaveform(); // Redraw to remove highlight
    }

    setupEventListeners() {
        // File upload
        const uploadArea = document.getElementById('uploadArea');
        const audioFile = document.getElementById('audioFile');
        const uploadBtn = document.getElementById('uploadBtn');
        const loadProjectBtn = document.getElementById('loadProjectBtn');
        
        console.log('Setting up event listeners...');
        console.log('Upload area:', uploadArea);
        console.log('Audio file input:', audioFile);
        console.log('Upload button:', uploadBtn);
        
        // Handle upload area click - improved for mobile
        uploadArea.addEventListener('click', (e) => {
            const isOnUploadBtn = (e.target === uploadBtn) || (uploadBtn && uploadBtn.contains(e.target));
            const isOnLoadProjectBtn = (e.target === loadProjectBtn) || (loadProjectBtn && loadProjectBtn.contains(e.target));
            if (!isOnUploadBtn && !isOnLoadProjectBtn) {
                audioFile.click();
            }
        });
        
        // Handle upload button click
        uploadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            audioFile.click();
        });
        
        // Load project (.zip) button
        if (loadProjectBtn) {
            loadProjectBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.zip,application/zip,application/x-zip-compressed';
                input.addEventListener('change', async (ev) => {
                    const file = ev.target.files[0];
                    if (!file) return;
                    try {
                        await this.importFromZip(file);
                    } catch (err) {
                        alert('Failed to import ZIP bundle: ' + (err?.message || err));
                    }
                });
                input.click();
            });
        }
        
        // Only add drag and drop for non-mobile devices
        if (!this.isMobileDevice()) {
            uploadArea.addEventListener('dragover', this.handleDragOver.bind(this));
            uploadArea.addEventListener('dragleave', this.handleDragLeave.bind(this));
            uploadArea.addEventListener('drop', this.handleDrop.bind(this));
        }
        
        audioFile.addEventListener('change', this.handleFileSelect.bind(this));
        
        console.log('Event listeners set up successfully');

        // Audio player events
        this.audioElement.addEventListener('loadedmetadata', this.onAudioLoaded.bind(this));
        this.audioElement.addEventListener('timeupdate', this.onTimeUpdate.bind(this));
        this.audioElement.addEventListener('play', () => this.isPlaying = true);
        this.audioElement.addEventListener('pause', () => this.isPlaying = false);
        
        // Video player events
        if (this.videoElement) {
            this.videoElement.addEventListener('loadedmetadata', () => {
                document.getElementById('duration').textContent = this.formatTime(this.videoElement.duration);
                // Ensure duration is available for timeline drawing
                this.audioBuffer = { duration: this.videoElement.duration || 0 };
                this.drawWaveform();
            });
            this.videoElement.addEventListener('timeupdate', () => {
                document.getElementById('currentTime').textContent = this.formatTime(this.videoElement.currentTime);
                if (this.settings.keepPlayheadInView && this.isPlaying) this.centerPlayheadIfNeeded();
                this.drawWaveform();
            });
            this.videoElement.addEventListener('play', () => this.isPlaying = true);
            this.videoElement.addEventListener('pause', () => this.isPlaying = false);
        }

        // Waveform click and drag
        this.canvas.addEventListener('click', this.onWaveformClick.bind(this));
        this.canvas.addEventListener('contextmenu', this.onWaveformRightClick.bind(this));
        this.canvas.addEventListener('mousedown', this.onWaveformMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this.onWaveformMouseMove.bind(this));
        this.canvas.addEventListener('mouseenter', this.onWaveformMouseEnter.bind(this));
        this.canvas.addEventListener('mouseleave', this.onWaveformMouseLeave.bind(this));
        this.canvas.addEventListener('mouseup', this.onWaveformMouseUp.bind(this));
        this.canvas.addEventListener('wheel', this.onWaveformWheel.bind(this));

        // Zoom controls
        document.getElementById('zoomIn').addEventListener('click', () => this.zoomIn());
        document.getElementById('zoomOut').addEventListener('click', () => this.zoomOut());
        document.getElementById('zoomReset').addEventListener('click', () => this.zoomReset());

        // Theme toggle
        if (this.themeToggle) {
            this.themeToggle.addEventListener('click', () => {
                const isDark = !document.body.classList.contains('theme-light');
                const next = isDark ? 'light' : 'dark';
                this.applyTheme(next);
            });
        }

        // Cue controls
        document.getElementById('addCueBtn').addEventListener('click', this.addCueAtCurrentTime.bind(this));
        document.getElementById('playFromStart').addEventListener('click', this.playFromStart.bind(this));
        
        const exportJsonBtn = document.getElementById('exportJson');
        const exportCsvBtn = document.getElementById('exportCsv');
        const importBtn = document.getElementById('importCues');
        if (exportJsonBtn) exportJsonBtn.addEventListener('click', this.exportCuesJson.bind(this));
        if (exportCsvBtn) exportCsvBtn.addEventListener('click', this.exportCuesCsv.bind(this));
        if (importBtn) importBtn.addEventListener('click', this.importCuesFlow.bind(this));

        // Export dropdown events
        const exportBtn = document.getElementById('exportBtn');
        const exportMenu = document.getElementById('exportMenu');
        if (exportBtn && exportMenu) {
            exportBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                exportMenu.style.display = exportMenu.style.display === 'none' ? 'block' : 'none';
            });
            exportMenu.addEventListener('click', (e) => {
                const btn = e.target.closest('.export-item');
                if (!btn) return;
                const type = btn.getAttribute('data-type');
                exportMenu.style.display = 'none';
                if (type === 'json') this.exportCuesJson();
                if (type === 'csv') this.exportCuesCsv();
                if (type === 'md') this.exportCuesMarkdown();
                if (type === 'pdf') this.exportCuesPdf();
                if (type === 'sheet') this.exportCuesSpreadsheet();
                if (type === 'ma3') this.exportMa3MacroXml();
                if (type === 'zip') this.exportBundleZip();
            });
            document.addEventListener('click', (e) => {
                if (!exportBtn.contains(e.target) && !exportMenu.contains(e.target)) {
                    exportMenu.style.display = 'none';
                }
            });
        }

        // Modal events
        document.getElementById('saveCue').addEventListener('click', this.saveCue.bind(this));
        document.getElementById('deleteCue').addEventListener('click', this.deleteCue.bind(this));
        document.getElementById('cancelCue').addEventListener('click', this.closeModal.bind(this));
        
        // Quick cue popup events
        document.getElementById('quickSave').addEventListener('click', this.saveQuickCue.bind(this));
        document.getElementById('quickCancel').addEventListener('click', this.cancelQuickCue.bind(this));
        
        // Quick cue popup keyboard shortcuts
        document.getElementById('quickCuePopup').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.saveQuickCue();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.cancelQuickCue();
            }
        });
        
        // Modal keyboard shortcuts
        document.getElementById('cueModal').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this.saveCue();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.closeModal();
            }
        });

        // Settings events
        document.getElementById('settingsBtn').addEventListener('click', this.showSettings.bind(this));
        document.getElementById('closeSettingsBtn').addEventListener('click', this.hideSettings.bind(this));
        document.getElementById('pauseOnCuePopup').addEventListener('change', this.updateSetting.bind(this));
        document.getElementById('showCueNumbers').addEventListener('change', this.updateSetting.bind(this));
        document.getElementById('resetSettings').addEventListener('click', this.resetSettings.bind(this));
        const useFadeTimesEl = document.getElementById('useFadeTimes');
        if (useFadeTimesEl) useFadeTimesEl.addEventListener('change', this.updateSetting.bind(this));
        const useMarkerColorEl = document.getElementById('useMarkerColor');
        if (useMarkerColorEl) useMarkerColorEl.addEventListener('change', this.updateSetting.bind(this));
        const keepPhEl = document.getElementById('keepPlayheadInView');
        if (keepPhEl) keepPhEl.addEventListener('change', this.updateSetting.bind(this));
        const ma3IdEl = document.getElementById('ma3Id');
        if (ma3IdEl) ma3IdEl.addEventListener('change', this.updateSetting.bind(this));
        const ma3TriggerEl = document.getElementById('ma3Trigger');
        if (ma3TriggerEl) ma3TriggerEl.addEventListener('change', this.updateSetting.bind(this));
        const ma3OverrideEl = document.getElementById('ma3OverrideEnabled');
        if (ma3OverrideEl) ma3OverrideEl.addEventListener('change', (e)=>{ this.updateSetting(e); this.applySettings(); });
        const ma3OverrideIdEl = document.getElementById('ma3OverrideId');
        if (ma3OverrideIdEl) ma3OverrideIdEl.addEventListener('change', this.updateSetting.bind(this));
        const ma3UseSeparateIdsEl = document.getElementById('ma3UseSeparateIds');
        if (ma3UseSeparateIdsEl) ma3UseSeparateIdsEl.addEventListener('change', (e)=>{ this.updateSetting(e); this.applySettings(); });
        const seqEl = document.getElementById('ma3SeqId'); if (seqEl) seqEl.addEventListener('change', this.updateSetting.bind(this));
        const tcEl = document.getElementById('ma3TcId'); if (tcEl) tcEl.addEventListener('change', this.updateSetting.bind(this));
        const pageEl = document.getElementById('ma3PageId'); if (pageEl) pageEl.addEventListener('change', this.updateSetting.bind(this));

        // Initialize custom color dropdowns
        this.initColorDropdown('quickCueColorDropdown');
        this.initColorDropdown('cueColorDropdown');

        // Close color dropdowns on outside click
        document.addEventListener('click', (e) => {
            document.querySelectorAll('.color-dropdown.open').forEach((dd) => {
                if (!dd.contains(e.target)) {
                    dd.classList.remove('open');
                }
            });
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', this.onKeyDown.bind(this));
    }

    initColorDropdown(dropdownId) {
        const dropdown = document.getElementById(dropdownId);
        if (!dropdown) return;
        const targetInputId = dropdown.getAttribute('data-target-input');
        const hiddenInput = targetInputId ? document.getElementById(targetInputId) : null;
        const toggle = dropdown.querySelector('.color-dropdown-toggle');
        const swatch = dropdown.querySelector('.color-swatch');
        const label = dropdown.querySelector('.color-label');
        const menu = dropdown.querySelector('.color-dropdown-menu');
        if (!toggle || !menu) return;

        // Open/close
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('open');
        });

        // Select color
        menu.querySelectorAll('.color-item').forEach((item) => {
            item.addEventListener('click', (e) => {
                const color = item.getAttribute('data-color') || '#ff4444';
                const text = item.getAttribute('data-label') || 'Red';
                if (hiddenInput) hiddenInput.value = color;
                if (swatch) swatch.style.background = color;
                if (label) label.textContent = text;
                dropdown.classList.remove('open');
            });
        });

        // Initialize from input
        const current = hiddenInput?.value || '#ff4444';
        if (swatch) swatch.style.background = current;
    }

    loadSettings() {
        const saved = localStorage.getItem('markersSettings');
        if (saved) {
            try {
                this.settings = { ...this.settings, ...JSON.parse(saved) };
            } catch (e) {
                console.warn('Failed to load settings:', e);
            }
        }
        this.applySettings();
    }

    saveSettings() {
        localStorage.setItem('markersSettings', JSON.stringify(this.settings));
    }

    applySettings() {
        // Apply pause on cue popup setting
        document.getElementById('pauseOnCuePopup').checked = this.settings.pauseOnCuePopup;
        
        // Apply show cue numbers setting
        document.getElementById('showCueNumbers').checked = this.settings.showCueNumbers;
        
        // Apply use fade times
        const useFade = !!this.settings.useFadeTimes;
        const fadeField = document.getElementById('cueFade');
        if (fadeField) fadeField.parentElement.style.display = useFade ? '' : 'none';
        
        // Apply marker color UI visibility
        const useMarkerColor = !!this.settings.useMarkerColor;
        const markerColorGroup = document.getElementById('cueMarkerColorGroup');
        if (markerColorGroup) markerColorGroup.style.display = useMarkerColor ? '' : 'none';
        const quickMarkerColorRow = document.getElementById('quickCueMarkerColorRow');
        if (quickMarkerColorRow) quickMarkerColorRow.style.display = useMarkerColor ? '' : 'none';
        
        // Apply keep playhead in view
        const keepPh = !!this.settings.keepPlayheadInView;
        const keepPhEl = document.getElementById('keepPlayheadInView');
        if (keepPhEl) keepPhEl.checked = keepPh;
        
        // Apply MA3 settings
        const ma3IdEl = document.getElementById('ma3Id');
        if (ma3IdEl) ma3IdEl.value = this.settings.ma3Id || 101;
        const ma3TriggerEl = document.getElementById('ma3Trigger');
        if (ma3TriggerEl) ma3TriggerEl.value = this.settings.ma3Trigger || 'Go+';
        const ma3OverrideEl = document.getElementById('ma3OverrideEnabled');
        if (ma3OverrideEl) ma3OverrideEl.checked = !!this.settings.ma3OverrideEnabled;
        const ma3OverrideBlock = document.getElementById('ma3OverrideBlock');
        if (ma3OverrideBlock) ma3OverrideBlock.style.display = this.settings.ma3OverrideEnabled ? '' : 'none';
        const ma3OverrideIdEl = document.getElementById('ma3OverrideId');
        if (ma3OverrideIdEl) ma3OverrideIdEl.value = this.settings.ma3OverrideId || (this.settings.ma3Id || 101);
        const ma3UseSeparateIdsEl = document.getElementById('ma3UseSeparateIds');
        if (ma3UseSeparateIdsEl) ma3UseSeparateIdsEl.checked = !!this.settings.ma3UseSeparateIds;
        const sepRow = document.getElementById('ma3SeparateIdsRow');
        if (sepRow) sepRow.style.display = this.settings.ma3OverrideEnabled && this.settings.ma3UseSeparateIds ? 'flex' : 'none';
        const seqEl = document.getElementById('ma3SeqId'); if (seqEl) seqEl.value = this.settings.ma3SeqId || this.settings.ma3OverrideId || this.settings.ma3Id || 101;
        const tcEl = document.getElementById('ma3TcId'); if (tcEl) tcEl.value = this.settings.ma3TcId || this.settings.ma3OverrideId || this.settings.ma3Id || 101;
        const pageEl = document.getElementById('ma3PageId'); if (pageEl) pageEl.value = this.settings.ma3PageId || this.settings.ma3OverrideId || this.settings.ma3Id || 101;

        // Update visible project badge
        this.updateProjectBadge();
        
        // Redraw waveform if settings changed
        if (this.waveformData || this.getDuration() > 0) {
            this.drawWaveform();
        }
    }

    updateSetting(e) {
        const setting = e.target.id;
        let value;
        if (e.target.type === 'checkbox') {
            value = e.target.checked;
        } else if (e.target.type === 'number') {
            value = Number(e.target.value) || 101;
        } else {
            value = e.target.value;
        }
        
        this.settings[setting] = value;
        this.saveSettings();
        this.applySettings();
        if (setting === 'ma3Id' || setting === 'ma3OverrideEnabled' || setting === 'ma3OverrideId' || setting === 'ma3UseSeparateIds' || setting === 'ma3SeqId' || setting === 'ma3TcId' || setting === 'ma3PageId') {
            this.updateProjectBadge();
        }
    }

    showSettings() {
        document.getElementById('settingsPanel').style.display = 'flex';
        document.getElementById('cuesPanel').style.display = 'none';
    }

    hideSettings() {
        document.getElementById('settingsPanel').style.display = 'none';
        document.getElementById('cuesPanel').style.display = 'flex';
    }

    resetSettings() {
        this.settings = {
            pauseOnCuePopup: true,
            showCueNumbers: true,
            useFadeTimes: true,
            useMarkerColor: true,
            keepPlayheadInView: true,
            ma3Id: 101,
            ma3Trigger: 'Go+',
            ma3OverrideEnabled: false,
            ma3OverrideId: 101,
            ma3UseSeparateIds: false,
            ma3SeqId: 101,
            ma3TcId: 101,
            ma3PageId: 101
        };
        this.saveSettings();
        this.applySettings();
    }

    applyTheme(theme) {
        if (theme === 'light') {
            document.body.classList.add('theme-light');
        } else {
            document.body.classList.remove('theme-light');
        }
        localStorage.setItem('theme', theme);
        if (this.themeToggle) {
            this.themeToggle.textContent = theme === 'light' ? '☀️' : '🌙';
            this.themeToggle.setAttribute('aria-label', 'Toggle theme');
            this.themeToggle.setAttribute('title', 'Toggle theme');
        }
        // Redraw waveform to reflect theme colors
        if (this.waveformData) this.drawWaveform();
    }

    onKeyDown(e) {
        // Ignore when typing in inputs/textareas or when modal is open
        const active = document.activeElement;
        const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
        const isModalOpen = document.getElementById('cueModal').style.display !== 'none';
        if (isTyping || isModalOpen) return;

        // Space or K: toggle play/pause
        if (e.code === 'Space' || e.key.toLowerCase() === 'k') {
            e.preventDefault();
            this.togglePlay();
            return;
        }

        // Arrow Left/Right: seek, with Shift for bigger step, Alt for fine step
        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            const step = e.shiftKey ? -5 : e.altKey ? -0.1 : -1;
            this.seekBy(step);
            return;
        }
        if (e.key === 'ArrowRight') {
            e.preventDefault();
            const step = e.shiftKey ? 5 : e.altKey ? 0.1 : 1;
            this.seekBy(step);
            return;
        }

        // , and . for frame-ish nudge (~0.05s)
        if (e.key === ',') {
            e.preventDefault();
            this.seekBy(-0.05);
            return;
        }
        if (e.key === '.') {
            e.preventDefault();
            this.seekBy(0.05);
            return;
        }

        // Zoom: +/=/Up to zoom in, -/_/Down to zoom out, 0 to reset
        if (e.key === '+' || e.key === '=' || e.key === 'Add') {
            e.preventDefault();
            this.zoomIn();
            return;
        }
        if (e.key === '-' || e.key === '_' || e.key === 'Subtract') {
            e.preventDefault();
            this.zoomOut();
            return;
        }
        if (e.key === '0') {
            e.preventDefault();
            this.zoomReset();
            return;
        }

        // M: add cue at current time
        if (e.key.toLowerCase() === 'm') {
            e.preventDefault();
            this.addCueAtCurrentTime();
            return;
        }

        // E: edit the first visible cue (if any)
        if (e.key.toLowerCase() === 'e') {
            e.preventDefault();
            const firstCue = this.cues[0];
            if (firstCue) {
                this.focusCueNameInput(firstCue.id);
            }
            return;
        }

        // [ and ]: jump to previous/next cue
        if (e.key === '[') {
            e.preventDefault();
            this.jumpToPreviousCue();
            return;
        }
        if (e.key === ']') {
            e.preventDefault();
            this.jumpToNextCue();
            return;
        }
    }

    togglePlay() {
        if (this.useVideo && this.videoElement) {
            if (this.videoElement.paused) this.videoElement.play(); else this.videoElement.pause();
            return;
        }
        if (!this.audioElement) return;
        if (this.audioElement.paused) {
            this.audioElement.play();
        } else {
            this.audioElement.pause();
        }
    }

    seekBy(deltaSeconds) {
        if (this.useVideo && this.videoElement) {
            const dur = this.videoElement.duration || 0;
            const newTime = Math.max(0, Math.min(dur, this.videoElement.currentTime + deltaSeconds));
            this.videoElement.currentTime = newTime;
            this.drawWaveform();
            return;
        }
        if (!this.audioElement || !this.audioBuffer) return;
        const newTime = Math.max(0, Math.min(this.audioBuffer.duration, this.audioElement.currentTime + deltaSeconds));
        this.audioElement.currentTime = newTime;
        this.drawWaveform();
    }

    jumpToPreviousCue() {
        const current = this.useVideo && this.videoElement ? this.videoElement.currentTime : this.audioElement.currentTime;
        if (!this.cues.length) return;
        const prevCues = this.cues.filter(c => c.time < current).sort((a, b) => b.time - a.time);
        if (prevCues.length) {
            const t = prevCues[0].time;
            if (this.useVideo && this.videoElement) this.videoElement.currentTime = t; else this.audioElement.currentTime = t;
        }
    }

    jumpToNextCue() {
        const current = this.useVideo && this.videoElement ? this.videoElement.currentTime : this.audioElement.currentTime;
        if (!this.cues.length) return;
        const nextCues = this.cues.filter(c => c.time > current).sort((a, b) => a.time - b.time);
        if (nextCues.length) {
            const t = nextCues[0].time;
            if (this.useVideo && this.videoElement) this.videoElement.currentTime = t; else this.audioElement.currentTime = t;
        }
    }

    handleDragOver(e) {
        e.preventDefault();
        e.currentTarget.classList.add('dragover');
    }

    handleDragLeave(e) {
        e.preventDefault();
        e.currentTarget.classList.remove('dragover');
    }

    handleDrop(e) {
        e.preventDefault();
        e.currentTarget.classList.remove('dragover');
        
        const files = e.dataTransfer.files;
        console.log('Files dropped:', files.length);
        if (files.length > 0) {
            console.log('Processing dropped file:', files[0]);
            this.loadMediaFile(files[0]);
        }
    }

    handleFileSelect(e) {
        const file = e.target.files[0];
        console.log('File selected:', file);
        if (file) {
            this.loadMediaFile(file);
        } else {
            console.log('No file selected');
        }
    }

    async loadMediaFile(file) {
        try {
            console.log('Loading media file:', file.name, file.type, file.size);
            this.uploadedFile = file; // keep original for bundle export
            const isVideo = /^video\//i.test(file.type) || /\.(mp4|webm|ogg)$/i.test(file.name);
            const isAudio = /^audio\//i.test(file.type) || /\.(mp3|wav|m4a|aac|ogg)$/i.test(file.name);
            if (!isAudio && !isVideo) throw new Error('Unsupported file type');

            // Set export basename from uploaded media filename
            if (file && file.name) {
                const base = file.name.replace(/\.[^.]+$/, '') || 'cues';
                this.mediaBasename = base;
            }

            const mediaUrl = URL.createObjectURL(file);

            // Switch UI based on media type
            if (isVideo) {
                this.useVideo = true;
                if (this.videoElement) {
                    this.videoElement.src = mediaUrl;
                    this.videoElement.style.display = '';
                }
                if (this.audioElement) {
                    this.audioElement.src = '';
                    this.audioElement.style.display = 'none';
                }

                // Try to decode audio track from the video for waveform (best-effort)
                try {
                    const arrayBuffer = await file.arrayBuffer();
                    if (!this.audioContext) this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    if (this.audioContext.state === 'suspended') { try { await this.audioContext.resume(); } catch (e) {} }
                    const decoded = await new Promise((resolve, reject) => {
                        try {
                            this.audioContext.decodeAudioData(arrayBuffer.slice(0), (buf) => resolve(buf), (err) => reject(err));
                        } catch (err) { reject(err); }
                    });
                    if (decoded && decoded.duration) {
                        this.audioBuffer = decoded;
                        this.generateWaveformData();
                    } else {
                        this.audioBuffer = { duration: this.videoElement?.duration || 0 };
                        this.waveformData = null;
                        this.drawWaveform();
                    }
                } catch (decodeErr) {
                    console.warn('Could not decode audio from video, showing timeline only.', decodeErr);
                    this.audioBuffer = { duration: this.videoElement?.duration || 0 };
                    this.waveformData = null;
                    this.drawWaveform();
                }
            } else {
                this.useVideo = false;
                if (this.audioElement) {
                    this.audioElement.crossOrigin = 'anonymous';
                    this.audioElement.src = mediaUrl;
                    this.audioElement.style.display = '';
                }
                if (this.videoElement) {
                    this.videoElement.src = '';
                    this.videoElement.style.display = 'none';
                }

                // Audio buffer decode for waveform (audio only)
                if (!this.audioContext) this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                if (this.audioContext.state === 'suspended') { try { await this.audioContext.resume(); } catch (e) {} }
                const arrayBuffer = await file.arrayBuffer();
                this.audioBuffer = await new Promise((resolve, reject) => {
                    try {
                        this.audioContext.decodeAudioData(arrayBuffer.slice(0), (buf) => resolve(buf), (err) => reject(err));
                    } catch (err) { reject(err); }
                });
                this.generateWaveformData();
            }

            // Show player and main content sections
            document.getElementById('playerSection').style.display = 'block';
            document.getElementById('mainContent').style.display = 'flex';
            // Hide upload area
            document.getElementById('uploadArea').style.display = 'none';

            // Resize canvas after sections are visible and force a redraw
            setTimeout(() => {
                this.resizeCanvas();
                this.drawWaveform();
            }, 100);

            // Update badge after media is set
            this.updateProjectBadge();

        } catch (error) {
            console.error('Error loading media file:', error);
        }
    }

    generateWaveformData() {
        if (!this.audioBuffer) {
            console.error('No audio buffer available');
            return;
        }
        
        const channelData = this.audioBuffer.getChannelData(0);
        console.log('Channel data length:', channelData.length);
        
        const samples = 2000; // Number of samples for visualization - more detail
        const blockSize = Math.floor(channelData.length / samples);
        this.waveformData = [];
        
        for (let i = 0; i < samples; i++) {
            let sum = 0;
            for (let j = 0; j < blockSize; j++) {
                sum += Math.abs(channelData[i * blockSize + j]);
            }
            this.waveformData.push(sum / blockSize);
        }
        
        console.log('Generated waveform data:', this.waveformData.length, 'samples');
        console.log('Sample values:', this.waveformData.slice(0, 10));
        
        // Check if we have valid data
        const maxAmplitude = Math.max(...this.waveformData);
        console.log('Max amplitude:', maxAmplitude);
        
        if (maxAmplitude === 0) {
            console.warn('Waveform data appears to be silent or empty');
        }
        
        this.drawWaveform();
    }

    drawWaveform() {
        // Draws background, optional waveform bars, time markers, cue markers, and playhead
        const canvas = this.canvas;
        const ctx = this.ctx;
        let width = canvas.width;
        let height = canvas.height;
        
        if (width === 0 || height === 0) {
            this.resizeCanvasOnly();
            width = canvas.width;
            height = canvas.height;
        }
        
        // Clear and background
        ctx.clearRect(0, 0, width, height);
        const isLight = document.body.classList.contains('theme-light');
        ctx.fillStyle = isLight ? '#f8f9fa' : '#0f172a';
        ctx.fillRect(0, 0, width, height);
        
        const duration = (this.audioBuffer?.duration) || (this.videoElement?.duration) || 0;
        const totalWidth = width * this.zoomLevel;
        
        // Draw waveform bars only if we have data (audio)
        if (this.waveformData && Array.isArray(this.waveformData) && this.waveformData.length) {
            const samples = this.waveformData.length;
            const barWidth = totalWidth / samples;
            const pixelsPerSample = totalWidth / samples;
            const firstVisibleSample = Math.max(0, Math.floor((-this.panOffset) / pixelsPerSample));
            const visibleSampleCount = Math.ceil(width / pixelsPerSample) + 2;
            const lastVisibleSample = Math.min(samples, firstVisibleSample + visibleSampleCount);
            const centerY = height / 2;
            const gradient = ctx.createLinearGradient(0, 0, 0, height);
            if (isLight) {
                gradient.addColorStop(0, '#2196F3');
                gradient.addColorStop(0.5, '#1976D2');
                gradient.addColorStop(1, '#0D47A1');
            } else {
                gradient.addColorStop(0, '#60a5fa');
                gradient.addColorStop(0.5, '#3b82f6');
                gradient.addColorStop(1, '#1d4ed8');
            }
            ctx.fillStyle = gradient;
            for (let i = firstVisibleSample; i < lastVisibleSample; i++) {
                if (i >= 0 && i < this.waveformData.length) {
                    const amplitude = this.waveformData[i];
                    const barHeight = Math.max(amplitude * height * 0.95, 6);
                    const x = (i * barWidth) + this.panOffset;
                    const y = centerY - barHeight / 2;
                    if (x + barWidth > 0 && x < width) {
                        this.drawRoundedRect(ctx, x, y, Math.max(barWidth - 0.5, 1.5), barHeight, 3);
                    }
                }
            }
            // Center line
            ctx.strokeStyle = isLight ? '#e0e0e0' : '#1f2937';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, height / 2);
            ctx.lineTo(width, height / 2);
            ctx.stroke();
        }
        
        // Time markers (for both audio and video)
        this.drawTimeMarkers();
        
        // Cue markers (for both audio and video)
        this.drawCueMarkers();
        
        // Playhead
        this.drawPlayhead();
    }
    
    drawRoundedRect(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
        ctx.fill();
    }
    
    drawPlayhead() {
        const canvas = this.canvas;
        const ctx = this.ctx;
        const width = canvas.width;
        const height = canvas.height;
        const currentTime = this.getCurrentTime();
        const duration = this.getDuration();
        const totalWidth = width * this.zoomLevel;
        
        if (duration <= 0) return;
        const playheadX = (currentTime / duration) * totalWidth + this.panOffset;
        
        // Only draw if playhead is visible
        if (playheadX >= -10 && playheadX <= width + 10) {
            const isLight = document.body.classList.contains('theme-light');
            const phColor = isLight ? '#0ea5e9' : '#22d3ee'; // cyan distinct from red markers
            // Draw playhead line
            ctx.strokeStyle = phColor;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(playheadX, 0);
            ctx.lineTo(playheadX, height);
            ctx.stroke();
            
            // Draw playhead triangle
            ctx.fillStyle = phColor;
            ctx.beginPath();
            ctx.moveTo(playheadX - 6, 0);
            ctx.lineTo(playheadX + 6, 0);
            ctx.lineTo(playheadX, 12);
            ctx.closePath();
            ctx.fill();
        }
    }

    drawPlayheadOnly() {
        // helper to only redraw playhead quickly when video is playing
        this.drawWaveform();
    }

    drawTimeMarkers() {
        const canvas = this.canvas;
        const ctx = this.ctx;
        const width = canvas.width;
        const height = canvas.height;
        const isLight = document.body.classList.contains('theme-light');
        
        ctx.strokeStyle = isLight ? '#ccc' : '#374151';
        ctx.lineWidth = 1;
        ctx.font = '12px Arial';
        ctx.fillStyle = isLight ? '#666' : '#cbd5e1';
        
        const duration = (this.audioBuffer?.duration) || (this.videoElement?.duration) || 0;
        const totalWidth = width * this.zoomLevel;
        const pixelsPerSecond = totalWidth / duration;
        
        // Choose major/minor grid spacing based on zoom
        let majorStep = 5; // seconds
        if (pixelsPerSecond > 300) majorStep = 0.5;
        else if (pixelsPerSecond > 150) majorStep = 1;
        else if (pixelsPerSecond > 60) majorStep = 2;
        else if (pixelsPerSecond > 30) majorStep = 5;
        else if (pixelsPerSecond > 15) majorStep = 10;
        else majorStep = 15;
        
        const minorStep = majorStep / 5;
        
        // Visible time range
        const timeStart = Math.max(0, (-this.panOffset) / pixelsPerSecond);
        const timeEnd = Math.min(duration, (width - this.panOffset) / pixelsPerSecond);
        
        // Draw minor ticks
        ctx.strokeStyle = isLight ? '#e6e6e6' : '#1f2937';
        for (let t = Math.floor(timeStart / minorStep) * minorStep; t <= timeEnd; t += minorStep) {
            const x = t * pixelsPerSecond + this.panOffset;
            if (x >= -20 && x <= width + 20) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
                ctx.stroke();
            }
        }
        
        // Draw major ticks with labels
        ctx.strokeStyle = isLight ? '#ccc' : '#374151';
        for (let t = Math.floor(timeStart / majorStep) * majorStep; t <= timeEnd; t += majorStep) {
            const x = t * pixelsPerSecond + this.panOffset;
            if (x >= -50 && x <= width + 50) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
                ctx.stroke();
                ctx.fillText(this.formatTimeDetailed(t), x + 5, 15);
            }
        }
    }

    drawCueMarkers() {
        const canvas = this.canvas;
        const ctx = this.ctx;
        const width = canvas.width;
        const height = canvas.height;
        const duration = this.getDuration();
        const totalWidth = width * this.zoomLevel;
        
        if (duration <= 0) return;
        const sorted = [...this.cues].sort((a, b) => a.time - b.time);
        sorted.forEach((cue, index) => {
            const x = (cue.time / duration) * totalWidth + this.panOffset;
            
            // Only draw if marker is visible
            if (x >= -20 && x <= width + 20) {
                // Marker style color
                const markerColor = (this.settings.useMarkerColor && cue.markerColor) ? cue.markerColor : '#ff4444';
                
                // Check if this cue is highlighted
                const isHighlighted = this.highlightedCueId === cue.id;
                
                // Draw marker line with shadow
                if (isHighlighted) {
                    // Enhanced shadow for highlighted marker
                    ctx.shadowColor = 'rgba(96, 165, 250, 0.8)';
                    ctx.shadowBlur = 15;
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 0;
                } else {
                    ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
                    ctx.shadowBlur = 4;
                    ctx.shadowOffsetX = 2;
                    ctx.shadowOffsetY = 2;
                }
                
                ctx.strokeStyle = isHighlighted ? '#60a5fa' : markerColor;
                ctx.lineWidth = isHighlighted ? 6 : 4;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
                ctx.stroke();
                
                // Reset shadow
                ctx.shadowColor = 'transparent';
                ctx.shadowBlur = 0;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 0;
                
                // Draw marker circle
                ctx.fillStyle = isHighlighted ? '#60a5fa' : markerColor;
                ctx.beginPath();
                ctx.arc(x, 15, isHighlighted ? 10 : 8, 0, 2 * Math.PI);
                ctx.fill();
                
                // Draw marker number (always visible inside circle)
                ctx.fillStyle = 'white';
                ctx.font = 'bold 10px Arial';
                ctx.textAlign = 'center';
                ctx.fillText((index + 1).toString(), x, 19);
                
                // Draw cue name with background
                ctx.textAlign = 'left';
                ctx.font = 'bold 11px Arial';
                const text = cue.name || 'Cue';
                const textWidth = ctx.measureText(text).width;
                
                // Background for text
                ctx.fillStyle = isHighlighted ? '#60a5fa' : ((this.settings.useMarkerColor && cue.markerColor) ? cue.markerColor : 'rgba(255, 68, 68, 0.9)');
                ctx.fillRect(x + 5, 5, textWidth + 8, 16);
                
                // Text
                ctx.fillStyle = 'white';
                ctx.fillText(text, x + 9, 16);
                
                // Draw fade triangle if enabled and fade > 0
                if (this.settings.useFadeTimes && Number(cue.fade) > 0) {
                    const duration = this.getDuration();
                    const totalWidth = width * this.zoomLevel;
                    const fadeSeconds = Number(cue.fade);
                    const fadeEndX = ((cue.time + fadeSeconds) / duration) * totalWidth + this.panOffset;
                    const baseY = height - 6;
                    const apexY = height - 40; // triangle height
                    const clampedEndX = Math.min(Math.max(fadeEndX, -20), width + 20);

                    // Match fade triangle color to marker color with transparency
                    const fadeColor = isHighlighted ? '#60a5fa' : ((this.settings.useMarkerColor && cue.markerColor) ? cue.markerColor : '#ff4444');
                    ctx.save();
                    ctx.fillStyle = fadeColor;
                    ctx.globalAlpha = 0.35;
                    ctx.beginPath();
                    ctx.moveTo(x, baseY);
                    ctx.lineTo(clampedEndX, baseY);
                    ctx.lineTo(x, apexY);
                    ctx.closePath();
                    ctx.fill();
                    ctx.restore();
                }
            }
        });
    }

    onAudioLoaded() {
        document.getElementById('duration').textContent = this.formatTime(this.audioElement.duration);
    }

    onTimeUpdate() {
        document.getElementById('currentTime').textContent = this.formatTime(this.audioElement.currentTime);
        if (this.settings.keepPlayheadInView && this.isPlaying) this.centerPlayheadIfNeeded();
        if (this.waveformData) {
            this.drawWaveform();
        }
    }

    onWaveformClick(e) {
        // Don't jump if we were dragging
        if (this.isDragging) return;
        
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const totalWidth = this.canvas.width * this.zoomLevel;
        const duration = this.getDuration();
        const clickTime = ((x - this.panOffset) / totalWidth) * duration;
        
        if (this.useVideo && this.videoElement) this.videoElement.currentTime = Math.max(0, Math.min(this.videoElement.duration || 0, clickTime));
        else if (this.audioElement && this.audioBuffer) this.audioElement.currentTime = Math.max(0, Math.min(this.audioBuffer.duration || 0, clickTime));
    }
    
    onWaveformRightClick(e) {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const totalWidth = this.canvas.width * this.zoomLevel;
        const duration = this.getDuration();
        const clickTime = ((x - this.panOffset) / totalWidth) * duration;
        
        // Add cue at clicked position
        this.addCueAtTime(clickTime);
    }
    
    onWaveformMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        
        // Check if clicking on a marker
        const clickedMarker = this.getMarkerAtPosition(x);
        if (clickedMarker) {
            this.draggedMarker = clickedMarker;
            this.draggedMarker.originalTime = clickedMarker.time; // Store original time
            this.isDragging = true;
            this.dragStartX = x;
            this.canvas.style.cursor = 'grabbing';
            return;
        }
        
        // Start panning
        this.isDragging = true;
        this.dragStartX = x;
        this.dragStartPan = this.panOffset;
        this.canvas.style.cursor = 'grabbing';
    }
    
    onWaveformMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        
        if (this.isDragging) {
            const deltaX = x - this.dragStartX;
            
            if (this.draggedMarker) {
                // Move marker with proper scaling
                const totalWidth = this.canvas.width * this.zoomLevel;
                const duration = this.getDuration();
                const timeDelta = (deltaX / totalWidth) * duration;
                
                // Calculate new time based on original position + delta
                const newTime = (this.draggedMarker.originalTime || this.draggedMarker.time) + timeDelta;
                this.draggedMarker.time = Math.max(0, Math.min(duration, newTime));
                this.updateCuesList();
                
                // Show time popup
                this.showTimePopup(x, this.draggedMarker.time);
            } else {
                // Pan waveform
                this.panOffset = this.dragStartPan + deltaX;
                this.constrainPan();
            }
            
            this.drawWaveform();
        } else {
            // Update cursor based on what's under the mouse
            const marker = this.getMarkerAtPosition(x);
            this.canvas.style.cursor = marker ? 'grab' : 'crosshair';
            
            // Show time popup when hovering over waveform
            const totalWidth = this.canvas.width * this.zoomLevel;
            const duration = this.getDuration();
            const hoverTime = ((x - this.panOffset) / totalWidth) * duration;
            if (hoverTime >= 0 && hoverTime <= duration) {
                this.showTimePopup(x, hoverTime);
            } else {
                this.hideTimePopup();
            }
        }
    }
    
    onWaveformMouseEnter(e) {
        this.canvas.style.cursor = 'crosshair';
    }
    
    onWaveformMouseLeave(e) {
        this.canvas.style.cursor = 'default';
        this.hideTimePopup();
    }
    
    onWaveformMouseUp(e) {
        if (this.draggedMarker) {
            // Clean up the temporary original time property
            delete this.draggedMarker.originalTime;
        }
        this.isDragging = false;
        this.draggedMarker = null;
        this.canvas.style.cursor = 'crosshair';
        this.hideTimePopup();
    }
    
    onWaveformWheel(e) {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        
        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
        const oldZoom = this.zoomLevel;
        this.zoomLevel = Math.max(0.1, Math.min(10, this.zoomLevel * zoomFactor));
        
        // Zoom towards mouse position
        const zoomRatio = this.zoomLevel / oldZoom;
        this.panOffset = x - (x - this.panOffset) * zoomRatio;
        
        this.constrainPan();
        this.updateZoomDisplay();
        this.drawWaveform();
    }
    
    getMarkerAtPosition(x) {
        const totalWidth = this.canvas.width * this.zoomLevel;
        const duration = this.getDuration();
        if (duration <= 0) return null;
        for (let cue of this.cues) {
            const markerX = (cue.time / duration) * totalWidth + this.panOffset;
            if (Math.abs(x - markerX) < 15) { // 15px tolerance
                return cue;
            }
        }
        return null;
    }
    
    constrainPan() {
        const totalWidth = this.canvas.width * this.zoomLevel;
        const maxPan = Math.max(0, totalWidth - this.canvas.width);
        this.panOffset = Math.max(-maxPan, Math.min(0, this.panOffset));
    }
    
    zoomIn() {
        this.zoomLevel = Math.min(10, this.zoomLevel * 1.5);
        this.constrainPan();
        this.updateZoomDisplay();
        this.drawWaveform();
    }
    
    zoomOut() {
        this.zoomLevel = Math.max(0.1, this.zoomLevel / 1.5);
        this.constrainPan();
        this.updateZoomDisplay();
        this.drawWaveform();
    }
    
    zoomReset() {
        this.zoomLevel = 1;
        this.panOffset = 0;
        this.updateZoomDisplay();
        this.drawWaveform();
    }
    
    updateZoomDisplay() {
        document.getElementById('zoomLevel').textContent = Math.round(this.zoomLevel * 100) + '%';
    }
    
    showTimePopup(x, time) {
        if (!this.timePopup) return;
        
        // Position popup relative to the waveform container, clamped within bounds
        const container = this.canvas.parentElement;
        const rect = container.getBoundingClientRect();
        const halfWidth = 60; // approx popup half width for clamping
        let popupX = x;
        popupX = Math.max(halfWidth, Math.min(rect.width - halfWidth, popupX));
        const popupY = rect.height - 35; // near bottom inside container
        
        this.timePopup.style.left = popupX + 'px';
        this.timePopup.style.top = popupY + 'px';
        this.timePopup.textContent = this.formatTimeDetailed(time);
        this.timePopup.style.display = 'block';
        this.timePopup.style.zIndex = '1000';
        this.timePopup.style.position = 'absolute';
        
        console.log('Showing time popup at:', popupX, popupY, 'Time:', this.formatTime(time));
    }
    
    hideTimePopup() {
        if (this.timePopup) {
            this.timePopup.style.display = 'none';
        }
    }

    addCueAtCurrentTime() {
        const time = this.getCurrentTime();
        this.showQuickCuePopup(time);
    }

    addCueWithTemplate(template) {
        const time = this.getCurrentTime();
        const templates = {
            'intro': { name: 'Intro', description: 'Song introduction' },
            'verse': { name: 'Verse', description: 'Main verse section' },
            'chorus': { name: 'Chorus', description: 'Chorus section' },
            'bridge': { name: 'Bridge', description: 'Bridge section' },
            'outro': { name: 'Outro', description: 'Song ending' },
            'dance-break': { name: 'Dance Break', description: 'Dance sequence' },
            'lighting-change': { name: 'Lighting Change', description: 'Lighting cue' },
            'costume-change': { name: 'Costume Change', description: 'Costume change cue' }
        };
        
        const templateData = templates[template] || { name: 'Cue', description: '' };
        
        // Show quick popup with template name pre-filled
        this.showQuickCuePopupWithTemplate(time, templateData.name);
    }

    showQuickCuePopupWithTemplate(time, templateName) {
        const popup = document.getElementById('quickCuePopup');
        const timeDisplay = document.getElementById('quickCueTime');
        const nameInput = document.getElementById('quickCueName');
        
        // Store the time value for later use
        this.pendingCueTime = time;
        timeDisplay.textContent = this.formatTime(time);
        nameInput.value = templateName;
        popup.style.display = 'block';
        
        // Focus and select the input
        setTimeout(() => {
            nameInput.focus();
            nameInput.select();
        }, 100);
    }

    addCueAtTime(time) {
        this.showQuickCuePopup(time);
    }

    showQuickCuePopup(time) {
        const popup = document.getElementById('quickCuePopup');
        const timeDisplay = document.getElementById('quickCueTime');
        const nameInput = document.getElementById('quickCueName');
        const fadeRow = document.getElementById('quickCueFadeRow');
        const fadeInput = document.getElementById('quickCueFade');
        const descInput = document.getElementById('quickCueDescription');
        
        // color dropdown
        const quickHidden = document.getElementById('quickCueMarkerColor');
        const quickDropdown = document.getElementById('quickCueColorDropdown');
        const quickSwatch = quickDropdown?.querySelector('.color-swatch');
        const quickLabel = quickDropdown?.querySelector('.color-label');
        
        // Store the time value for later use
        this.pendingCueTime = time;
        timeDisplay.textContent = this.formatTime(time);
        nameInput.value = '';
        if (fadeInput) fadeInput.value = '';
        if (descInput) descInput.value = '';
        if (quickHidden) quickHidden.value = '#ff4444';
        if (quickSwatch) quickSwatch.style.background = '#ff4444';
        if (quickLabel) quickLabel.textContent = 'Red';
        if (quickDropdown) quickDropdown.classList.remove('open');
        
        if (fadeRow) fadeRow.style.display = this.settings.useFadeTimes ? '' : 'none';
        popup.style.display = 'block';
        
        // Pause playback if setting is enabled (supports video and audio)
        this.wasPlayingBeforePopup = false;
        this.wasPlayingBeforePopupMedia = null;
        if (this.settings.pauseOnCuePopup) {
            if (this.useVideo && this.videoElement && !this.videoElement.paused) {
                this.wasPlayingBeforePopup = true;
                this.wasPlayingBeforePopupMedia = 'video';
                this.videoElement.pause();
            } else if (this.audioElement && !this.audioElement.paused) {
                this.wasPlayingBeforePopup = true;
                this.wasPlayingBeforePopupMedia = 'audio';
                this.audioElement.pause();
            }
        }
        
        // Focus and select the input
        setTimeout(() => {
            nameInput.focus();
            nameInput.select();
        }, 100);
    }

    hideQuickCuePopup() {
        const popup = document.getElementById('quickCuePopup');
        popup.style.display = 'none';
        
        // Resume playback if it was playing before the popup (supports video and audio)
        if (this.wasPlayingBeforePopup) {
            if (this.wasPlayingBeforePopupMedia === 'video' && this.videoElement) {
                this.videoElement.play().catch(e => console.warn('Failed to resume video playback:', e));
            } else if (this.wasPlayingBeforePopupMedia === 'audio' && this.audioElement) {
                this.audioElement.play().catch(e => console.warn('Failed to resume audio playback:', e));
            }
        }
        this.wasPlayingBeforePopup = false;
        this.wasPlayingBeforePopupMedia = null;
    }

    saveQuickCue() {
        const nameInput = document.getElementById('quickCueName');
        const fadeInput = document.getElementById('quickCueFade');
        const descInput = document.getElementById('quickCueDescription');
        const qcHidden = document.getElementById('quickCueMarkerColor');
        
        // Use stored pending time, fallback to current player time
        let time = this.pendingCueTime;
        if (typeof time !== 'number' || !Number.isFinite(time)) {
            time = Number(this.audioElement?.currentTime || 0);
        }
        const name = ((nameInput?.value) || '').trim() || 'Cue';
        let fade = this.settings.useFadeTimes ? Number(fadeInput?.value || 0) : 0;
        if (!Number.isFinite(fade) || fade < 0) fade = 0;
        const description = ((descInput?.value) || '').trim();
        const markerColor = this.settings.useMarkerColor ? (qcHidden?.value || '#ff4444') : '';
        
        const cue = {
            id: Date.now(),
            name,
            time,
            description,
            fade,
            markerColor
        };
        
        this.cues.push(cue);
        this.renumberCues();
        this.updateCuesList();
        this.drawWaveform();
        
        this.hideQuickCuePopup();
        this.pendingCueTime = null;
    }

    cancelQuickCue() {
        this.hideQuickCuePopup();
        this.pendingCueTime = null;
    }

    updateCuesList() {
        const cuesList = document.getElementById('cuesList');
        cuesList.innerHTML = '';
        
        // Sort cues by time and assign sequential numbers
        const sortedCues = [...this.cues].sort((a, b) => a.time - b.time);
        sortedCues.forEach((c, i) => c.number = i + 1);
        
        sortedCues.forEach(cue => {
            const cueElement = document.createElement('div');
            cueElement.className = 'cue-item';
            const colorEnabled = !!this.settings.useMarkerColor && cue.markerColor;
            const colorSwatchHtml = colorEnabled ? `<span class="cue-color-dot" style="background:${cue.markerColor}"></span>` : '';
            cueElement.innerHTML = `
                <div class="cue-info">
                    <div class="cue-name-container">
                        <span class="cue-number">#${cue.number}</span>
                        ${colorSwatchHtml}
                        <input type="text" class="cue-name-input" value="${cue.name || 'Cue'}" 
                               data-cue-id="${cue.id}" 
                               placeholder="Enter cue name"
                               onblur="app.updateCueName(${cue.id}, this.value)"
                               onkeypress="if(event.key==='Enter') this.blur()"
                               ondblclick="event.stopPropagation()">
                    </div>
                    <div class="cue-time">${this.formatTime(cue.time)}${Number(cue.fade)>0 ? ` • Fade ${Number(cue.fade).toFixed(1)}s` : ''}</div>
                    <div class="cue-description-container">
                        <textarea class="cue-description-input" 
                                  data-cue-id="${cue.id}" 
                                  placeholder="Add description..."
                                  onblur="app.updateCueDescription(${cue.id}, this.value)"
                                  onkeypress="if(event.key==='Enter' && !event.shiftKey) { event.preventDefault(); this.blur(); }"
                                  ondblclick="event.stopPropagation()">${cue.description || ''}</textarea>
                    </div>
                </div>
                <div class="cue-actions">
                    <button class="edit-btn" onclick="app.editCue(${cue.id})" title="Open detailed editor (Ctrl+E)">Edit</button>
                    <button class="jump-btn" onclick="app.jumpToCue(${cue.id})" title="Jump to this cue">Jump</button>
                </div>
            `;
            
            // Apply colored border if marker colors enabled
            if (colorEnabled) {
                cueElement.style.borderLeftColor = cue.markerColor;
            } else {
                cueElement.style.borderLeftColor = '';
            }
            
            // Add double-click to edit functionality
            cueElement.addEventListener('dblclick', (e) => {
                if (e.target.classList.contains('cue-name-input') || e.target.classList.contains('cue-description-input')) {
                    return; // Let the input handle its own double-click
                }
                this.focusCueNameInput(cue.id);
            });
            
            // Add hover highlighting functionality
            cueElement.addEventListener('mouseenter', () => {
                this.highlightMarker(cue.id);
            });
            
            cueElement.addEventListener('mouseleave', () => {
                this.unhighlightMarker(cue.id);
            });
            
            cuesList.appendChild(cueElement);
        });
    }

    updateCueName(cueId, newName) {
        const cue = this.cues.find(c => c.id === cueId);
        if (cue) {
            cue.name = newName || 'Cue';
            this.drawWaveform(); // Update waveform display
        }
    }

    updateCueDescription(cueId, newDescription) {
        const cue = this.cues.find(c => c.id === cueId);
        if (cue) {
            cue.description = newDescription || '';
        }
    }

    focusCueNameInput(cueId) {
        const input = document.querySelector(`input[data-cue-id="${cueId}"]`);
        if (input) {
            input.focus();
            input.select();
        }
    }

    focusCueDescriptionInput(cueId) {
        const textarea = document.querySelector(`textarea[data-cue-id="${cueId}"]`);
        if (textarea) {
            textarea.focus();
        }
    }

    editCue(cueId) {
        const cue = this.cues.find(c => c.id === cueId);
        if (!cue) return;
        
        this.currentCueId = cueId;
        // Show computed number (by sorted order)
        document.getElementById('cueNumber').value = this.getCueNumber(cueId);
        document.getElementById('cueName').value = cue.name;
        document.getElementById('cueTime').value = this.formatTime(cue.time);
        document.getElementById('cueFade').value = Number(cue.fade || 0);
        document.getElementById('cueDescription').value = cue.description;
        const hiddenMarker = document.getElementById('cueMarkerColor'); if (hiddenMarker) hiddenMarker.value = cue.markerColor || '#ff4444';
        // Sync modal dropdown swatch/label
        const modalDropdown = document.getElementById('cueColorDropdown');
        if (modalDropdown) {
            const sw = modalDropdown.querySelector('.color-swatch');
            const lbl = modalDropdown.querySelector('.color-label');
            if (sw) sw.style.background = hiddenMarker?.value || '#ff4444';
            if (lbl && hiddenMarker?.value) {
                const item = modalDropdown.querySelector(`.color-item[data-color="${hiddenMarker.value}"]`);
                lbl.textContent = item?.getAttribute('data-label') || 'Red';
            }
        }
        
        document.getElementById('cueModal').style.display = 'flex';
        
        // Auto-focus the name field
        setTimeout(() => {
            document.getElementById('cueName').focus();
            document.getElementById('cueName').select();
        }, 100);
    }

    saveCue() {
        if (!this.currentCueId) return;
        
        const cue = this.cues.find(c => c.id === this.currentCueId);
        if (cue) {
            cue.name = document.getElementById('cueName').value || `Cue`;
            cue.description = document.getElementById('cueDescription').value;
            cue.fade = Math.max(0, Number(document.getElementById('cueFade').value || 0));
            const mcInput = document.getElementById('cueMarkerColor');
            cue.markerColor = this.settings.useMarkerColor ? (mcInput?.value || '#ff4444') : '';
            
            this.renumberCues();
            this.updateCuesList();
            this.drawWaveform();
        }
        
        this.closeModal();
    }

    deleteCue(cueIdOrEvent) {
        // Support being called from list (with id) or from modal button (with event)
        const id = (typeof cueIdOrEvent === 'number') ? cueIdOrEvent : this.currentCueId;
        if (id == null) {
            this.closeModal();
            return;
        }
        this.cues = this.cues.filter(c => c.id !== id);
        this.renumberCues();
        this.updateCuesList();
        this.drawWaveform();
        this.closeModal();
    }

    jumpToCue(cueId) {
        const cue = this.cues.find(c => c.id === cueId);
        if (cue) {
            const currentTime = this.useVideo && this.videoElement ? this.videoElement.currentTime : this.audioElement.currentTime;
            if (this.useVideo && this.videoElement) this.videoElement.currentTime = cue.time; else this.audioElement.currentTime = cue.time;
        }
    }

    playFromStart() {
        const currentTime = this.useVideo && this.videoElement ? this.videoElement.currentTime : this.audioElement.currentTime;
        if (this.useVideo && this.videoElement) this.videoElement.currentTime = 0; else this.audioElement.currentTime = 0;
        this.audioElement.play();
    }

    closeModal() {
        document.getElementById('cueModal').style.display = 'none';
        this.currentCueId = null;
    }

    exportCues() {
        const exportData = {
            audioFile: this.audioElement.src,
            duration: this.audioBuffer.duration,
            cues: this.cues.map(cue => ({
                name: cue.name,
                time: cue.time,
                timeFormatted: this.formatTime(cue.time),
                description: cue.description,
                fade: cue.fade,
                markerColor: cue.markerColor
            }))
        };
        
        const dataStr = JSON.stringify(exportData, null, 2);
        const dataBlob = new Blob([dataStr], {type: 'application/json'});
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(dataBlob);
        link.download = 'cue-points.json';
        link.click();
    }

    exportCuesJson() {
        const sorted = [...this.cues].sort((a, b) => a.time - b.time).map((c, i) => ({
            number: i + 1,
            title: c.name || 'Cue',
            description: c.description || '',
            time: c.time,
            timeFormatted: this.formatTime(c.time),
            fade: Number(c.fade || 0),
            markerColor: c.markerColor || ''
        }));
        const exportData = {
            audioFile: this.useVideo ? this.videoElement?.src : this.audioElement?.src,
            duration: this.audioBuffer?.duration || this.videoElement?.duration || 0,
            cues: sorted,
            settings: this.settings
        };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        const base = this.mediaBasename || this.importedBasename || 'cues';
        const exportId = Math.max(1, Number(this.settings.ma3Id) || 101);
        a.download = `${exportId}_${base}.json`;
        a.click();
    }

    exportCuesCsv() {
        const fps = 30;
        const base = this.mediaBasename || this.importedBasename || 'cues';
        const trackName = base;
        const typeName = 'Lighting';
        const sorted = [...this.cues]
            .sort((a, b) => a.time - b.time)
            .map((c, i) => ({
                cueNo: i + 1,
                label: this.sanitizeForCsv(c.name || 'Cue'),
                timecode: this.sanitizeForCsv(this.formatTimecodeFrames(c.time, fps)),
                fade: Number(c.fade || 0)
            }));
        const headers = ['"Track"','"Type"','"Position"','"Cue No"','"Label"','"Fade"'];
        const cleanTrack = this.sanitizeForCsv(trackName);
        const cleanType = this.sanitizeForCsv(typeName);
        const rows = sorted.map(r => `"${cleanTrack}","${cleanType}","${r.timecode}","${r.cueNo}","${r.label}","${this.sanitizeForCsv(String(r.fade))}"`);
        const csv = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${exportId}_${base}.csv`;
        a.click();
    }

    exportCuesSpreadsheet() {
        const base = this.mediaBasename || this.importedBasename || 'cues';
        const sorted = [...this.cues]
            .sort((a, b) => a.time - b.time)
            .map((c, i) => ({
                cueNo: i + 1,
                name: this.sanitizeForCsv(c.name || 'Cue'),
                description: this.sanitizeForCsv(c.description || ''),
                time: c.time,
                timeFormatted: this.formatTime(c.time),
                timecode: this.formatTimecodeFrames(c.time, 30),
                fade: Number(c.fade || 0),
                markerColor: c.markerColor || '#ff4444',
                colorName: this.getColorName(c.markerColor || '#ff4444')
            }));
        
        const headers = [
            'Cue #',
            'Name', 
            'Description',
            'Time (seconds)',
            'Time (MM:SS)',
            'Timecode (HH:MM:SS:FF)',
            'Fade (seconds)',
            'Marker Color',
            'Color Name'
        ];
        
        const rows = sorted.map(r => [
            r.cueNo,
            r.name,
            r.description,
            r.time.toFixed(3),
            r.timeFormatted,
            r.timecode,
            r.fade,
            r.markerColor,
            r.colorName
        ]);
        
        const csv = [headers.join(','), ...rows.map(row => row.map(cell => `"${cell}"`).join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${exportId}_${base}_spreadsheet.csv`;
        a.click();
    }

    getColorName(color) {
        const colorMap = {
            '#ff4444': 'Red',
            '#4444ff': 'Blue', 
            '#44ff44': 'Green',
            '#ffff44': 'Yellow',
            '#ff44ff': 'Magenta',
            '#44ffff': 'Cyan',
            '#ff8844': 'Orange',
            '#8844ff': 'Purple'
        };
        return colorMap[color] || 'Custom';
    }

    updateProjectBadge() {
        const badge = document.getElementById('projectBadge');
        const idEl = document.getElementById('badgeId');
        const trackEl = document.getElementById('badgeTrack');
        if (!badge || !idEl || !trackEl) return;
        const id = Math.max(1, Number(this.settings?.ma3Id) || 101);
        const base = this.mediaBasename || this.importedBasename || 'cues';
        idEl.textContent = `ID ${id}`;
        trackEl.textContent = base;
        badge.style.display = '';
    }

    exportCuesMarkdown() {
        const base = this.mediaBasename || this.importedBasename || 'cues';
        const exportId = Math.max(1, Number(this.settings.ma3Id) || 101);
        const lines = [];
        lines.push(`# ${exportId}_${base} - Cue List`);
        lines.push('');
        lines.push('| # | Title | Time | Fade (s) | Description |');
        lines.push('|---:|---|---:|---:|---|');
        const sorted = [...this.cues].sort((a,b) => a.time - b.time);
        for (let i = 0; i < sorted.length; i++) {
            const c = sorted[i];
            const num = i + 1;
            const title = (c.name || 'Cue').replace(/\|/g, '\\|');
            const time = this.formatTime(c.time);
            const fade = Number(c.fade || 0);
            const desc = (c.description || '').replace(/\|/g, '\\|');
            lines.push(`| ${num} | ${title} | ${time} | ${fade} | ${desc} |`);
        }
        const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${exportId}_${base}.md`;
        a.click();
    }

    exportCuesPdf() {
        const base = this.mediaBasename || this.importedBasename || 'cues';
        const exportId = Math.max(1, Number(this.settings.ma3Id) || 101);
        const sorted = [...this.cues].sort((a,b) => a.time - b.time);
        const rowsHtml = sorted.map((c, i) => {
            const num = i + 1;
            const title = (c.name || 'Cue').replace(/&/g,'&amp;').replace(/</g,'&lt;');
            const time = this.formatTime(c.time);
            const fade = Number(c.fade || 0);
            const desc = (c.description || '').replace(/&/g,'&amp;').replace(/</g,'&lt;');
            return `<tr><td class=\"num\">${num}</td><td class=\"title\">${title}</td><td class=\"time\">${time}</td><td class=\"fade\">${fade}</td><td class=\"desc\">${desc}</td></tr>`;
        }).join('');
        const html = `<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>${exportId}_${base} - Cue List</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;margin:24px;}
h1{font-size:20px;margin:0 0 16px 0;}
.table{border-collapse:collapse;width:100%;}
.table th,.table td{border:1px solid #ddd;padding:8px;font-size:12px;}
.table th{background:#f3f4f6;text-align:left;}
.table td.num{text-align:right;width:40px}
.table td.time,.table td.fade{text-align:right;width:80px}
.footer{margin-top:16px;font-size:11px;color:#6b7280}
@media print{.noprint{display:none}}
</style>
</head><body>
<h1>${exportId}_${base} - Cue List</h1>
<table class=\"table\"><thead><tr><th>#</th><th>Title</th><th>Time</th><th>Fade (s)</th><th>Description</th></tr></thead>
<tbody>${rowsHtml}</tbody></table>
<div class=\"footer\">Generated ${new Date().toLocaleString()}</div>
<script>window.addEventListener('load',()=>{setTimeout(()=>{window.print()}, 150)});</script>
</body></html>`;
        const w = window.open('', '_blank');
        if (w) {
            w.document.open();
            w.document.write(html);
            w.document.close();
        } else {
            alert('Popup blocked. Please allow popups to export PDF.');
        }
    }

    generateMa3MacroXml() {
        const base = this.mediaBasename || this.importedBasename || 'cues';
        const sorted = [...this.cues].sort((a, b) => a.time - b.time);
        if (!sorted.length) {
            return null;
        }

        // Determine IDs
        const exportId = Math.max(1, Number(this.settings.ma3Id) || 101);
        const override = !!this.settings.ma3OverrideEnabled;
        const useSeparate = !!this.settings.ma3UseSeparateIds;
        const singleOverrideId = Math.max(1, Number(this.settings.ma3OverrideId) || exportId);
        const seqId = override ? (useSeparate ? Math.max(1, Number(this.settings.ma3SeqId) || singleOverrideId) : singleOverrideId) : exportId;
        const tcId = override ? (useSeparate ? Math.max(1, Number(this.settings.ma3TcId) || singleOverrideId) : singleOverrideId) : exportId;
        const pageId = override ? (useSeparate ? Math.max(1, Number(this.settings.ma3PageId) || singleOverrideId) : singleOverrideId) : exportId;
        const trigger = this.settings.ma3Trigger || 'Go+';

        // Helpers
        const xmlEscape = (s) => String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
        const q = (s) => `"${xmlEscape(s)}"`;
        const t3 = (n) => (Math.max(0, Number(n) || 0)).toFixed(3).replace(/0+$/,'').replace(/\.$/,'');

        const duration = this.getDuration();
        const fps = 30;
        const nowTag = new Date().toISOString()
            .replaceAll('-', 'd')
            .replaceAll(':', 't')
            .slice(0, 19);
        const dpName = `Markers${nowTag}`; // temporary datapool
        const macroName = `${exportId}_${base}`;

        const lines = [];
        lines.push('<?xml version="1.0" encoding="UTF-8"?>');
        lines.push('<GMA3 DataVersion="1.4.0.0">');
        lines.push(`  <Macro Name=${q(macroName)}>`);

        // Setup and DataPool/Sequence
        lines.push(`    <MacroLine Command=${q('cd root')} Wait="0.01"/>`);
        lines.push(`    <MacroLine Command=${q('Store Appearance "Cue Point Lighting"')}/>`);
        lines.push(`    <MacroLine Command=${q('Set Appearance "Cue Point Lighting" Property Color "1,1,1,0" BackR "83" BackG "18" BackB "24" BackAlpha "221"')}/>`);

        // Create appearances per unique marker color
        const uniqueColors = Array.from(new Set(sorted.map(c => (c.markerColor || '').toLowerCase()).filter(Boolean)));
        const colorAppName = (hex) => {
            const norm = hex.replace(/[^0-9a-f]/gi, '').slice(0,6).toLowerCase();
            return `Cue Color #${norm}`;
        };
        const parseHex = (hex) => {
            const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
            if (!m) return { r: 255, g: 68, b: 68 };
            const n = m[1];
            return { r: parseInt(n.slice(0,2),16), g: parseInt(n.slice(2,4),16), b: parseInt(n.slice(4,6),16) };
        };
        uniqueColors.forEach(hex => {
            const { r, g, b } = parseHex(hex);
            const name = colorAppName(hex);
            lines.push(`    <MacroLine Command=${q(`Store Appearance "${name}"`)}/>`);
            lines.push(`    <MacroLine Command=${q(`Set Appearance "${name}" Property Color "1,1,1,0" BackR "${r}" BackG "${g}" BackB "${b}" BackAlpha "221"`)}/>`);
        });
        lines.push(`    <MacroLine Command=${q(`Delete DataPool "${dpName}" /NC`)}/>`);
        lines.push(`    <MacroLine Command=${q(`Store DataPool "${dpName}" /NC`)}/>`);
        lines.push(`    <MacroLine Command=${q(`Delete DataPool "${dpName}" Sequence 1 /NC`)}/>`);

        // Create sequence and first pass of cues
        for (let i = 0; i < sorted.length; i++) {
            const cueNo = i + 1;
            lines.push(`    <MacroLine Command=${q(`Store DataPool "${dpName}" Sequence ${seqId} Cue ${cueNo} /Merge`)}/>`);
            const fade = Math.max(0, Number(sorted[i].fade || 0));
            lines.push(`    <MacroLine Command=${q(`DataPool "${dpName}" Sequence ${seqId} Cue ${cueNo} CueFade ${fade}`)}/>`);
            const hex = (sorted[i].markerColor || '').toLowerCase();
            const app = hex ? colorAppName(hex) : 'Cue Point Lighting';
            lines.push(`    <MacroLine Command=${q(`Set DataPool "${dpName}" Sequence ${seqId} Cue ${cueNo} Property APPEARANCE "${app}"`)}/>`);
        }
        lines.push(`    <MacroLine Command=${q(`Set  DataPool "${dpName}" Sequence ${seqId} Property APPEARANCE "Cue Point Lighting"`)}/>`);

        // Timecode object
        lines.push(`    <MacroLine Command=${q('cd root')}/>`);
        lines.push(`    <MacroLine Command=${q(`Store DataPool "${dpName}" Timecode ${tcId}`)}/>`);
        lines.push(`    <MacroLine Command=${q(`cd DataPool "${dpName}" Timecode ${tcId}`)}/>`);
        lines.push(`    <MacroLine Command=${q('Store 1 "Markers"')}/>`);
        lines.push(`    <MacroLine Command=${q('cd 1')}/>`);
        lines.push(`    <MacroLine Command=${q('cd root')}/>`);
        lines.push(`    <MacroLine Command=${q(`cd DataPool "${dpName}"`)}/>`);
        lines.push(`    <MacroLine Command=${q('cd "Timecodes"')}/>`);
        lines.push(`    <MacroLine Command=${q(`set ${tcId} Property FRAMEREADOUT "${fps} fps"`)}/>`);
        lines.push(`    <MacroLine Command=${q(`set ${tcId} Property OFFSETTCSLOT "0"`)}/>`);
        lines.push(`    <MacroLine Command=${q(`set ${tcId} Property DURATION "${t3(duration)}"`)}/>`);
        lines.push(`    <MacroLine Command=${q(`set ${tcId} Property IGNOREFOLLOW "1"`)}/>`);
        lines.push(`    <MacroLine Command=${q(`set ${tcId} Property PLAYBACKANDRECORD "Manual Events"`)}/>`);
        lines.push(`    <MacroLine Command=${q('cd root')}/>`);
        lines.push(`    <MacroLine Command=${q(`cd DataPool "${dpName}" Timecode ${tcId}`)}/>`);
        lines.push(`    <MacroLine Command=${q('cd 1')}/>`);
        lines.push(`    <MacroLine Command=${q(`Assign DataPool "${dpName}" Sequence ${seqId} At 1`)}/>`);
        lines.push(`    <MacroLine Command=${q('cd 1')}/>`);
        lines.push(`    <MacroLine Command=${q('cd 1')}/>`);
        lines.push(`    <MacroLine Command=${q('Store Type "CmdSubTrack" 1')}/>`);
        lines.push(`    <MacroLine Command=${q('cd 1')}/>`);

        // CmdSubTrack events for each cue: trigger at time
        for (let i = 0; i < sorted.length; i++) {
            const n = i + 1;
            lines.push(`    <MacroLine Command=${q(`Store ${n}`)}/>`);
            lines.push(`    <MacroLine Command=${q(`Set ${n} "TIME" "${t3(sorted[i].time)}"`)}/>`);
            lines.push(`    <MacroLine Command=${q(`Set ${n} "TOKEN" "${trigger}"`)}/>`);
        }

        // Assign each cue to timecode track index
        lines.push(`    <MacroLine Command=${q('cd root')}/>`);
        lines.push(`    <MacroLine Command=${q(`cd DataPool "${dpName}"`)}/>`);
        for (let i = 0; i < sorted.length; i++) {
            const n = i + 1;
            lines.push(`    <MacroLine Command=${q(`Assign DataPool ${dpName} Sequence  ${seqId} Cue ${n} At Timecode ${tcId}.1.1.1.1.${n}`)}/>`);
        }

        // Page and labels/notes
        lines.push(`    <MacroLine Command=${q('cd root')} Wait="0.01"/>`);
        lines.push(`    <MacroLine Command=${q(`Store Page ${pageId}`)}/>`);
        lines.push(`    <MacroLine Command=${q(`Assign DataPool "${dpName}" Sequence ${seqId} At Page ${pageId}.101`)}/>`);
        for (let i = 0; i < sorted.length; i++) {
            const n = i + 1;
            const title = sorted[i].name || `Cue ${n}`;
            const notes = sorted[i].description || '';
            lines.push(`    <MacroLine Command=${q(`Label DataPool "${dpName}" Sequence ${seqId} Cue ${n} "${title}"`)}/>`);
            if (notes) {
                lines.push(`    <MacroLine Command=${q(`Set DataPool "${dpName}" Sequence ${seqId} Cue ${n} Property "note" "${notes}"`)}/>`);
            }
        }
        lines.push(`    <MacroLine Command=${q(`Label DataPool "${dpName}" Sequence ${seqId} "Lighting ${seqId}"`)}/>`);
        lines.push(`    <MacroLine Command=${q(`Label DataPool "${dpName}" Timecode ${tcId} "${base}"`)}/>`);
        lines.push(`    <MacroLine Command=${q(`Label Page ${pageId} "${base}"`)}/>`);

        // Cleanup: move to main pool number and delete temp datapool
        lines.push(`    <MacroLine Command=${q(`Move DataPool "${dpName}" Sequence 1 Thru At Sequence ${seqId}`)}/>`);
        lines.push(`    <MacroLine Command=${q(`Move DataPool "${dpName}" Timecode 1 Thru At Timecode ${tcId}`)}/>`);
        lines.push(`    <MacroLine Command=${q(`Delete DataPool "${dpName}" /NoConfirm`)}/>`);

        lines.push('  </Macro>');
        lines.push('</GMA3>');

        return lines.join('\n');
    }

    exportMa3MacroXml() {
        const base = this.mediaBasename || this.importedBasename || 'cues';
        const exportId = Math.max(1, Number(this.settings.ma3Id) || 101);
        const xml = this.generateMa3MacroXml();
        if (!xml) {
            alert('No cues to export.');
            return;
        }
        const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${exportId}_${base}_macro.xml`;
        a.click();
    }

    importCuesFlow() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,.csv,.zip,text/csv,application/json,application/zip,application/x-zip-compressed';
        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const name = file.name || 'cues';
            if (name.toLowerCase().endsWith('.zip')) {
                try {
                    await this.importFromZip(file);
                } catch (err) {
                    alert('Failed to import ZIP bundle: ' + (err?.message || err));
                }
                return;
            }
            // record basename without extension for default export naming
            this.importedBasename = name.replace(/\.[^.]+$/, '') || 'cues';
            const text = await file.text();
            try {
                if (name.toLowerCase().endsWith('.json')) {
                    const data = JSON.parse(text);
                    this.importFromJson(data);
                } else {
                    this.importFromCsv(text);
                }
            } catch (err) {
                alert('Failed to import cues: ' + err.message);
            }
        });
        input.click();
    }

    async importFromZip(zipFile) {
        if (!window.JSZip) throw new Error('JSZip not loaded');
        const zip = await JSZip.loadAsync(zipFile);
        // Determine base name from zip filename
        const zipBase = (zipFile.name || 'cues').replace(/\.[^.]+$/, '') || 'cues';
        this.importedBasename = zipBase;
        this.mediaBasename = zipBase;

        // Find media file (prefer in media/ folder)
        let mediaEntry = null;
        zip.forEach((path, entry) => {
            if (!entry.dir && /^(media\/).+/.test(path)) {
                mediaEntry = mediaEntry || entry;
            }
        });
        // If not found in media/, pick first video/audio-like extension
        if (!mediaEntry) {
            zip.forEach((path, entry) => {
                if (mediaEntry || entry.dir) return;
                if (/\.(mp3|wav|m4a|aac|ogg|mp4|webm|mov|mkv)$/i.test(path)) mediaEntry = entry;
            });
        }

        // Load cues file: prefer json then csv
        let cuesJsonEntry = zip.file(new RegExp(`^${zipBase}\.json$`, 'i'))?.[0];
        let cuesCsvEntry = zip.file(new RegExp(`^${zipBase}\.csv$`, 'i'))?.[0];
        if (!cuesJsonEntry) {
            // fallback: any .json in root
            cuesJsonEntry = zip.file(/^[^/]+\.json$/i)?.[0] || null;
        }
        if (!cuesCsvEntry) {
            cuesCsvEntry = zip.file(/^[^/]+\.csv$/i)?.[0] || null;
        }

        // Load media first (if present)
        if (mediaEntry) {
            const mediaBlob = await mediaEntry.async('blob');
            const mediaName = mediaEntry.name.split('/').pop();
            const mediaFile = new File([mediaBlob], mediaName, { type: this.getMimeFromName(mediaName) });
            await this.loadMediaFile(mediaFile);
        }

        // Load cues data
        if (cuesJsonEntry) {
            const text = await cuesJsonEntry.async('text');
            const data = JSON.parse(text);
            this.importFromJson(data);
        } else if (cuesCsvEntry) {
            const text = await cuesCsvEntry.async('text');
            this.importFromCsv(text);
        } else {
            // No cues found; still show media if loaded
            if (!mediaEntry) throw new Error('Bundle contained no recognizable media or cues');
        }
    }

    getMimeFromName(name) {
        const ext = (name.split('.').pop() || '').toLowerCase();
        switch (ext) {
            case 'mp3': return 'audio/mpeg';
            case 'wav': return 'audio/wav';
            case 'm4a': return 'audio/mp4';
            case 'aac': return 'audio/aac';
            case 'ogg': return 'audio/ogg';
            case 'mp4': return 'video/mp4';
            case 'webm': return 'video/webm';
            case 'mov': return 'video/quicktime';
            case 'mkv': return 'video/x-matroska';
            default: return '';
        }
    }

    importFromJson(json) {
        if (!json || !Array.isArray(json.cues)) throw new Error('Invalid JSON format');
        this.cues = json.cues.map(c => ({
            id: Date.now() + Math.random(),
            name: c.title || c.name || 'Cue',
            time: Number(c.time ?? 0),
            description: c.description || '',
            fade: Math.max(0, Number(c.fade || 0)),
            markerColor: c.markerColor || ''
        }));
        // Restore settings if present
        if (json.settings && typeof json.settings === 'object') {
            this.settings = { ...this.settings, ...json.settings };
            this.saveSettings();
            this.applySettings();
        }
        this.renumberCues();
        this.updateCuesList();
        this.drawWaveform();
        this.updateProjectBadge();
    }

    importFromCsv(csvText) {
        const lines = csvText.split(/\r?\n/).filter(Boolean);
        if (!lines.length) throw new Error('Empty CSV');
        const header = lines.shift().split(',').map(h => h.trim().toLowerCase());
        const idx = {
            number: header.indexOf('number'),
            title: header.indexOf('title'),
            description: header.indexOf('description'),
            time_seconds: header.indexOf('time_seconds'),
            timecode: header.indexOf('timecode'),
            fade_seconds: header.indexOf('fade_seconds'),
            time: header.indexOf('time'),
            time_formatted: header.indexOf('time_formatted'),
            fade: header.indexOf('fade'),
            marker_color: header.indexOf('marker_color')
        };
        const parseTime = (t, tc) => {
            const n = Number(t);
            if (!Number.isNaN(n)) return n;
            // hh:mm:ss:ff
            if (tc) {
                const m = /^\s*(\d{1,2}):(\d{2}):(\d{2}):(\d{2})\s*$/.exec(tc);
                if (m) {
                    const hh = Number(m[1]);
                    const mm = Number(m[2]);
                    const ss = Number(m[3]);
                    const ff = Number(m[4]);
                    const fps = 30;
                    return hh * 3600 + mm * 60 + ss + (ff / fps);
                }
            }
            // parse mm:ss
            const m = /^\s*(\d+):(\d{1,2})(?:\.(\d{1,3}))?\s*$/.exec(String(t));
            if (m) {
                const min = Number(m[1]);
                const sec = Number(m[2]);
                const ms = Number(m[3] || 0);
                return min * 60 + sec + ms / 1000;
            }
            return 0;
        };
        const cues = lines.map(line => {
            // naive CSV split respecting quotes
            const cells = [];
            let cur = '';
            let inQ = false;
            for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (ch === '"') {
                    if (inQ && line[i+1] === '"') { cur += '"'; i++; }
                    else { inQ = !inQ; }
                } else if (ch === ',' && !inQ) {
                    cells.push(cur); cur = '';
                } else {
                    cur += ch;
                }
            }
            cells.push(cur);
            const title = idx.title >= 0 ? cells[idx.title] : 'Cue';
            const description = idx.description >= 0 ? cells[idx.description] : '';
            const fadeVal = idx.fade_seconds >= 0 ? Number(cells[idx.fade_seconds]) : (idx.fade >= 0 ? Number(cells[idx.fade]) : 0);
            const timeVal = idx.time_seconds >= 0
                ? parseTime(cells[idx.time_seconds], cells[idx.timecode >= 0 ? idx.timecode : -1])
                : (idx.timecode >= 0
                    ? parseTime(undefined, cells[idx.timecode])
                    : (idx.time >= 0
                        ? parseTime(cells[idx.time])
                        : (idx.time_formatted >= 0 ? parseTime(cells[idx.time_formatted]) : 0)));
            const markerColor = idx.marker_color >= 0 ? cells[idx.marker_color] : '';
            return { id: Date.now() + Math.random(), name: title, time: timeVal, description, fade: Math.max(0, Number(fadeVal || 0)), markerColor };
        });
        this.cues = cues.filter(c => Number.isFinite(c.time)).sort((a,b) => a.time - b.time);
        this.renumberCues();
        this.updateCuesList();
        this.drawWaveform();
    }

    getCueNumber(cueId) {
        const sorted = [...this.cues].sort((a, b) => a.time - b.time);
        const idx = sorted.findIndex(c => c.id === cueId);
        return idx >= 0 ? idx + 1 : '';
    }

    renumberCues() {
        const sorted = [...this.cues].sort((a, b) => a.time - b.time);
        sorted.forEach((c, i) => c.number = i + 1);
    }

    formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    formatTimeDetailed(seconds) {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        const milliseconds = Math.floor((seconds - Math.floor(seconds)) * 1000);
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}.${Math.floor(milliseconds / 10)
            .toString()
            .padStart(2, '0')}`;
    }

    formatTimecodeFrames(seconds, fps = 30) {
        const total = Math.max(0, Number(seconds) || 0);
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const secs = Math.floor(total % 60);
        const frames = Math.round((total - Math.floor(total)) * fps);
        const hh = String(hours).padStart(2, '0');
        const mm = String(minutes).padStart(2, '0');
        const ss = String(secs).padStart(2, '0');
        const ff = String(Math.min(frames, fps - 1)).padStart(2, '0');
        return `${hh}:${mm}:${ss}:${ff}`;
    }

    sanitizeForCsv(value) {
        const s = String(value ?? '');
        // Remove problematic characters for external CSV importers
        // commas, quotes, newlines, tabs, semicolons
        return s
            .replace(/[",\n\r\t;]+/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    getDuration() {
        return (this.audioBuffer?.duration) || (this.videoElement?.duration) || 0;
    }

    getCurrentTime() {
        if (this.useVideo && this.videoElement) return this.videoElement.currentTime || 0;
        if (this.audioElement) return this.audioElement.currentTime || 0;
        return 0;
    }

    async exportBundleZip() {
        try {
            if (!window.JSZip) {
                alert('JSZip is not loaded.');
                return;
            }
            const zip = new JSZip();
            const base = this.mediaBasename || this.importedBasename || 'cues';
            const exportId = Math.max(1, Number(this.settings.ma3Id) || 101);
            // media
            if (this.uploadedFile) {
                const mediaFolder = zip.folder('media');
                if (mediaFolder) mediaFolder.file(this.uploadedFile.name, this.uploadedFile);
            }
            // cues.json
            const jsonData = {
                audioFile: this.useVideo ? this.videoElement?.src : this.audioElement?.src,
                duration: this.audioBuffer?.duration || this.videoElement?.duration || 0,
                cues: [...this.cues].sort((a,b)=>a.time-b.time).map((c,i)=>({
                    number: i+1,
                    title: c.name||'Cue',
                    description: c.description||'',
                    time: c.time,
                    timeFormatted: this.formatTime(c.time),
                    fade: Number(c.fade||0),
                    markerColor: c.markerColor||''
                })),
                settings: this.settings
            };
            zip.file(`${exportId}_${base}.json`, JSON.stringify(jsonData, null, 2));
            // cues.csv (CuesExample format)
            const fps = 30;
            const headers = ['"Track"','"Type"','"Position"','"Cue No"','"Label"','"Fade"'];
            const trackName = base;
            const typeName = 'Lighting';
            const cleanTrack = this.sanitizeForCsv(trackName);
            const cleanType = this.sanitizeForCsv(typeName);
            const rows = this.cues
                .slice()
                .sort((a,b)=>a.time-b.time)
                .map((c,i)=>`"${cleanTrack}","${cleanType}","${this.sanitizeForCsv(this.formatTimecodeFrames(c.time,fps))}","${i+1}","${this.sanitizeForCsv(c.name||'Cue')}","${this.sanitizeForCsv(String(Number(c.fade||0)))}"`);
            const csv = [headers.join(','), ...rows].join('\n');
            zip.file(`${exportId}_${base}.csv`, csv);
            
            // cues_spreadsheet.csv (detailed version)
            const sorted = [...this.cues]
                .sort((a, b) => a.time - b.time)
                .map((c, i) => ({
                    cueNo: i + 1,
                    name: this.sanitizeForCsv(c.name || 'Cue'),
                    description: this.sanitizeForCsv(c.description || ''),
                    time: c.time,
                    timeFormatted: this.formatTime(c.time),
                    timecode: this.formatTimecodeFrames(c.time, 30),
                    fade: Number(c.fade || 0),
                    markerColor: c.markerColor || '#ff4444',
                    colorName: this.getColorName(c.markerColor || '#ff4444')
                }));
            
            const spreadsheetHeaders = [
                'Cue #',
                'Name', 
                'Description',
                'Time (seconds)',
                'Time (MM:SS)',
                'Timecode (HH:MM:SS:FF)',
                'Fade (seconds)',
                'Marker Color',
                'Color Name'
            ];
            
            const spreadsheetRows = sorted.map(r => [
                r.cueNo,
                this.sanitizeForCsv(r.name),
                this.sanitizeForCsv(r.description),
                this.sanitizeForCsv(r.time.toFixed(3)),
                this.sanitizeForCsv(r.timeFormatted),
                this.sanitizeForCsv(r.timecode),
                this.sanitizeForCsv(String(r.fade)),
                this.sanitizeForCsv(r.markerColor),
                this.sanitizeForCsv(r.colorName)
            ]);
            
            const spreadsheetCsv = [spreadsheetHeaders.join(','), ...spreadsheetRows.map(row => row.map(cell => `"${cell}"`).join(','))].join('\n');
            zip.file(`${exportId}_${base}_spreadsheet.csv`, spreadsheetCsv);
            
            // MA3 macro XML
            const ma3Xml = this.generateMa3MacroXml();
            if (ma3Xml) {
                zip.file(`${exportId}_${base}_macro.xml`, ma3Xml);
            }
            
            // readme
            const readme = `# ${exportId}_${base}\n\nBundle contains:\n- media/${this.uploadedFile ? this.uploadedFile.name : '(no media saved)'}\n- ${exportId}_${base}.json\n- ${exportId}_${base}.csv\n- ${exportId}_${base}_spreadsheet.csv (Detailed format)\n- ${exportId}_${base}_macro.xml (MA3 Macro)\n\nGenerated: ${new Date().toLocaleString()}\n`;
            zip.file('README.md', readme);
            // generate
            const blob = await zip.generateAsync({ type: 'blob' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${exportId}_${base}.zip`;
            a.click();
        } catch (err) {
            console.error('ZIP export failed', err);
            alert('ZIP export failed: ' + (err?.message || err));
        }
    }

    centerPlayheadIfNeeded() {
        const width = this.canvas.width;
        const duration = this.getDuration();
        if (duration <= 0) return;
        const totalWidth = width * this.zoomLevel;
        const playheadX = (this.getCurrentTime() / duration) * totalWidth + this.panOffset;
        const margin = 60; // px
        if (playheadX < margin) {
            this.panOffset += (margin - playheadX);
            this.constrainPan();
        } else if (playheadX > width - margin) {
            this.panOffset -= (playheadX - (width - margin));
            this.constrainPan();
        }
    }
}

// Initialize the app when the page loads
let app;
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing app...');
    
    // Add a visual indicator that the app is loading
    const uploadArea = document.getElementById('uploadArea');
    if (uploadArea) {
        uploadArea.style.border = '3px dashed #4CAF50';
        uploadArea.style.background = 'rgba(76, 175, 80, 0.1)';
    }
    
    app = new MusicCueApp();
    console.log('App initialized:', app);
    
    // Change border back to normal after initialization
    if (uploadArea) {
        setTimeout(() => {
            uploadArea.style.border = '3px dashed #fff';
            uploadArea.style.background = 'rgba(255, 255, 255, 0.1)';
        }, 1000);
    }

    // Warn on unload if there is an active project with cues/media
    window.addEventListener('beforeunload', (e) => {
        try {
            const hasMedia = !!(app?.audioElement?.src || app?.videoElement?.src);
            const hasCues = Array.isArray(app?.cues) && app.cues.length > 0;
            if (hasMedia || hasCues) {
                e.preventDefault();
                e.returnValue = '';
                return '';
            }
        } catch {}
    });
});

