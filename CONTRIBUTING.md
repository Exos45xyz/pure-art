# Contributing

Thanks for wanting to make Pure Art better. A few things keep it the way it is.

## Run it

```bash
npm install
npm run dev
```

Open http://127.0.0.1:5321. No build step beyond Vite, no framework: plain JavaScript and three.js.

## Before you open a pull request

- **Keep it small.** One change per pull request. For anything bigger than a fix, open an issue first so we can agree on it.
- **The smoke is the art.** A change to the flow, the light or the grade (`simulation.js`, `smoke.js`, `grade.js`, `cube.js`) changes what people see. Say so in the pull request, with an image of the pure look in white and the original look in dusk, before and after (S saves one).
- **Check it where people use it.** Chrome, Safari and Firefox on a computer, and a real phone if you touched the panel or the sheet. Press Space to pause, H to hide the panel, R to randomize: nothing should break.
- **Respect reduced motion.** Anything that moves gets a still version under `prefers-reduced-motion`.
- **Comments say why.** The code explains its choices in plain sentences; please keep doing that.

## Licence

By contributing you agree that your work is shared under the [MIT licence](LICENSE), like everything else here.
