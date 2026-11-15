# X-Music to-do

## Known bugs

- The artist text is clipped at its left edge in the filter pane and the song list (an artist "Example Quartet" reads "xample Quartet", "Example Trio" reads "t Trio"), as if the column scrolled sideways. Seen 2026-11-14 on a library of 11 synthetic tracks at an app window of 1377 by 862. Find why the cell scrolls, fix it, and add a test.

## Website

- Once the clipped artists are fixed, retake the X-Music screenshot on the Projects page of x-tech-laboratories.github.io (`public/screenshots/x-music.png`, linked from `src/content/docs/projects.mdx`). It currently shows the clipped names.
