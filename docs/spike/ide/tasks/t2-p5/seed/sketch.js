// A ball that bounces off the edges of the canvas.
let x, y, vx, vy;
const R = 20;

function setup() {
  createCanvas(400, 300);
  x = width / 2;
  y = height / 2;
  vx = 3;
  vy = 2;
}

function draw() {
  background(30);
  x += vx;
  y += vy;
  if (x < R || x > width - R) vx = -vx;
  if (y < R || y > height - R) vy = -vy;
  noStroke();
  fill(255, 200, 0);
  circle(x, y, R * 2);
}
