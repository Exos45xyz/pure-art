// Compiling ahead. A GPU program compiles the first time something draws with it, and the page (and
// the browser's own drawing, the loading bar included) waits until it is done: about a second for
// this app's 19 programs. Here the drawing code runs once with every renderer.render turned into a
// compile of what that call would draw, into the render target it would draw into, so the programs
// come out exactly as the real draws will ask for them. The browser compiles them on its own threads
// (KHR_parallel_shader_compile) while the page keeps drawing; the promise resolves when all are ready,
// and the real first draw finds them made. Nothing is drawn.
export function compileAhead(renderer, draws) {
  const jobs = [];
  const draw = renderer.render;
  renderer.render = (scene, camera) => { jobs.push(renderer.compileAsync(scene, camera)); };
  try {
    draws();
  } finally {
    renderer.render = draw;
  }
  return Promise.all(jobs);
}
