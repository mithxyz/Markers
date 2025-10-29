# Markers - Timecode Cues

A web-based tool for creating timecoded cues on music tracks for choreography and lighting. Perfect for dance studios, theater productions, and live performance planning.

![Markers Logo](mlogo2.png)

## Features

- **Waveform Visualization**: Visual representation of audio with interactive timeline
- **Precise Cue Placement**: Add cues at exact timestamps with visual markers
- **Multi-Format Export**: Export to JSON, CSV (CuePoints format), Spreadsheet CSV, Markdown, PDF, and MA3 Macro XML
- **Project Bundles**: Save complete projects as ZIP files including media and all data
- **Color-Coded Markers**: Assign colors to cues for visual organization
- **Fade Times**: Optional fade time settings for each cue
- **MA3 Integration**: Generate macros for GrandMA3 lighting software
- **Dark/Light Themes**: Comfortable viewing in any environment
- **Keyboard Shortcuts**: Fast workflow with comprehensive keyboard support

## Getting Started

1. Open `index.html` in a modern web browser (Chrome, Firefox, Safari, or Edge)
2. Drag and drop an audio or video file, or click "Choose File"
3. Start adding cues at specific timestamps
4. Export your work in your preferred format

### Supported Media Formats

**Audio**: MP3, WAV, M4A, AAC, OGG  
**Video**: MP4, WebM, OGG (audio track will be extracted for waveform)

## Usage

### Adding Cues

- **Keyboard**: Press `M` to add a cue at the current playback time
- **Mouse**: Right-click on the waveform to add a cue
- **Button**: Click "Add Cue at Current Time" in the player controls

A popup will appear for instant title entry. Press `Enter` to save or `Escape` to cancel.

### Editing Cues

- Click on any cue in the list to open the edit modal
- Or press `E` to quickly edit the first cue's name
- Right-click a cue in the list for options

### Waveform Controls

- **Left Click**: Jump to time
- **Right Click**: Add cue marker
- **Drag Background**: Pan the timeline
- **Drag Marker**: Move cue to new time (shows time popup)
- **Mouse Wheel**: Zoom in/out

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` or `K` | Play/Pause |
| `←` / `→` | Seek ±1s (Shift: ±5s, Alt: ±0.1s) |
| `,` / `.` | Nudge −/+0.05s |
| `+` / `−` / `0` | Zoom in/out/reset |
| `M` | Add cue at current time |
| `E` | Edit first cue name |
| `[` / `]` | Jump to previous/next cue |
| `Enter` | Save in quick popup |
| `Escape` | Cancel popup/modal |
| `Ctrl+Enter` | Save in modal |

## Export Formats

### JSON
Complete project data including cues, settings, and metadata. Ideal for backup and sharing.

### CSV (CuePoints Format)
Compatible with CuePoints software. Format: Track, Type, Position (timecode), Cue No, Label, Fade.

### Spreadsheet CSV
Detailed format with all cue information including:
- Cue number, name, description
- Time in seconds, MM:SS format, and timecode (HH:MM:SS:FF)
- Fade times, marker colors, and color names

### Markdown
Formatted table suitable for documentation and reports.

### PDF
Print-ready cue list for physical reference.

### MA3 Macro XML
Generates GrandMA3 macro files for direct import into lighting software:
- Creates sequences, timecodes, and pages
- Supports color-coded appearances matching cue marker colors
- Configurable Sequence/Timecode/Page IDs
- Go+ or Goto trigger options

### Bundle ZIP
Complete project package containing:
- Media file (in `media/` folder)
- JSON data
- Both CSV formats
- MA3 macro XML
- README with project info

## MA3 Integration

Markers can generate macros for GrandMA3 lighting software.

### Settings

1. **Export ID** (default: 101): Used as prefix for all export filenames and defaults for MA3 IDs
2. **MA3 Override**: Optionally use different IDs for MA3 macro
   - Can use a single override ID for Sequence/Timecode/Page
   - Or specify separate IDs for each
3. **Trigger Type**: Choose "Go+" or "Goto" for timecode events

### Generated Macro Features

- Creates temporary DataPool with unique name
- Generates appearances with colors matching cue markers
- Sets up sequences with cues at correct timestamps
- Configures timecode object with proper framerate and duration
- Creates page assignments for easy access
- Adds cue labels and notes from descriptions
- Cleans up temporary DataPool after setup

## Settings

Access settings via the ⚙️ button in the cues panel.

### Project ID
- **Export ID**: Prefix for all export filenames (default: 101)

### Playback Behavior
- **Pause on cue popup**: Automatically pauses when creating cues
- **Use fade times**: Enable fade time input for cues

### Display Options
- **Show cue numbers**: Display numbers on waveform markers
- **Color markers**: Use per-cue colors for markers
- **Keep playhead in view**: Auto-pan timeline during playback

### MA3 Export Settings
- **Trigger Type**: Go+ or Goto for timecode events
- **Override Export ID**: Use different IDs for MA3 macro
- **Separate IDs**: Specify different IDs for Sequence/Timecode/Page

## Tips

- **Save Frequently**: Use "Export Bundle (.zip)" to save your work. Work is NOT auto-saved!
- **Project Badge**: The ID and track name are visible in the toolbar for quick reference
- **Color Organization**: Use different marker colors to visually organize cue sections
- **Keyboard Workflow**: Learn keyboard shortcuts for faster cue creation
- **Import Projects**: Use "Load Project (.zip)" to restore saved work

## Technical Details

### Browser Requirements

- Modern browser with ES6+ support
- Web Audio API support
- File API support
- JavaScript enabled

### Dependencies

- **JSZip** (via CDN): For ZIP bundle creation/import

### Local Storage

Settings and preferences are stored in browser localStorage. Clearing browser data will reset preferences.

## Project Structure

```
Markers/
├── index.html          # Main HTML file
├── script.js           # Application logic
├── styles.css          # Styling
├── mlogo2.png          # Logo
├── README.md           # This file
└── example/            # Example projects
```

## Contributing

This project is maintained by [mith.xyz](https://www.mith.xyz). 

- **Website**: https://www.mith.xyz
- **GitHub**: https://github.com/mithxyz/Markers
- **Support**: [Buy me a coffee](https://www.buymeacoffee.com/mith)

## License

See repository for license information.

## Acknowledgments

Created for choreographers, lighting designers, and performance directors who need precise timing control for their productions.

---

**⚠️ Important**: Work is not auto-saved. Always use "Export Bundle (.zip)" to save your progress before closing the browser or reloading the page.

