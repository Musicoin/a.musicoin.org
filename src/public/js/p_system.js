/*
The MIT License (MIT)

Copyright (c) 2012 Richard Teammco

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/


// PARTICLE SYSTEM

/* color constants */
COLOR_VAL_FIRE = 0;
COLOR_VAL_RED = 1;
COLOR_VAL_GREEN = 2;
COLOR_VAL_VIOLET = 3;
COLOR_VAL_BLUE = 4;


// angle of impact (which direction the particles shoot)
ANGLE = 0;

// maximum speed of the particles
SPEED = 4;

// size (in radius, by pixel) of each particle
PARTICLE_SIZE = 1;

// number of particles per "explosion"
NUMBER_OF_PARTICLES = 60;

// how spread out (in degrees) the particles are from point of origin
RANGE_OF_ANGLE = 200;

// the average lifespan of each particle
PARTICLE_LIFESPAN = 50;

// color of the particles
PARTICLE_COLOR = COLOR_VAL_FIRE;

// constantly update mouse positions (for fire animations)
var mousePosX = 0;
var mousePosY = 200;

// if enabled, animate "fire" effect (spark each frame)
var fire = true;

// if enabled, fire will follow the mouse (if animating fire)
var follow = false;

// list of particles
var particles = new Array();

var particle_canvas;
var pCtx;
var pCtxWidth;
var pCtxHeight;

function initParticleAnimation() {
	console.log("Initializing...")
  particle_canvas = document.getElementById("particle_canvas");
  pCtx = particle_canvas.getContext("2d");
  pCtxWidth = $("#particle_canvas").width();
  pCtxHeight = $("#particle_canvas").height();

  // click listener (starts sparks at click location on canvas)
  $("#particle_canvas").click(function(e){
    RANGE_OF_ANGLE = 360;
    hasUserInteracted = true;
    // create a spark if fire is not animating
    if(!fire){
      var x = e.pageX - $("#particle_canvas").offset().left;
      var y = e.pageY - $("#particle_canvas").offset().top;
      spark(x, y, ANGLE);
    }
    // otherwise, toggle follow mouse on or off
    else{
      follow = !follow;
      if(follow){ // if follow is re-enabled, update the mouse position
        var x = e.pageX - $("#particle_canvas").offset().left;
        var y = e.pageY - $("#particle_canvas").offset().top;
        mousePosX = x;
        mousePosY = y;
      }
    }
  });

// disable double-click events
  $("#particle_canvas").dblclick(function(e){
    e.preventDefault();
  });

// listen to mouse movement events for positioning
  $("#particle_canvas").mousemove(function(e){
    if(follow){ // if flame is following the mouse
      // calculate the mouse position on the canvas
      var x = e.pageX - $("#particle_canvas").offset().left;
      var y = e.pageY - $("#particle_canvas").offset().top;
      mousePosX = x;
      mousePosY = y;
    }
  });

  setTimeout("animationUpdate()", 1);
}

// draw a new series of spark particles
function spark(x, y, angle){
	// create 20 particles 10 degrees surrounding the angle
	for(var i=0; i<NUMBER_OF_PARTICLES; i++){
		// get an offset between the range of the particle
		var offset = Math.round(RANGE_OF_ANGLE*Math.random())
			- RANGE_OF_ANGLE/2;
		var scaleX = Math.round(SPEED*Math.random()) + 1;
		var scaleY = Math.round(SPEED*Math.random()) + 1;
		particles.push(new Particle(x, y,
			Math.cos((angle+offset) * Math.PI / 180) * scaleX,
			Math.sin((angle+offset) * Math.PI / 180) * scaleY,
			PARTICLE_LIFESPAN, PARTICLE_COLOR));
	}
}


// animation update function (updates all particles)
//	if fire is on, create a "spark" in the current mouse position
function animationUpdate(){
	// if fire is active, animate a fire
	if(fire)
		spark(mousePosX, mousePosY, ANGLE);
	// update and draw particles
	pCtx.clearRect(0, 0, pCtxWidth, pCtxHeight);
	for(var i=0; i<particles.length; i++){
		if(particles[i].dead()){
			particles.splice(i, 1);
			i--;
		}
		else{
			particles[i].update();
			particles[i].draw(pCtx);
		}
	}
	// await next frame
	setTimeout("animationUpdate()", 30);
}

// set color by string
function setColor(colorVal){
	switch(colorVal){
		case "fire":	PARTICLE_COLOR = COLOR_VAL_FIRE;	break;
		case "red":		PARTICLE_COLOR = COLOR_VAL_RED;		break;
		case "green":	PARTICLE_COLOR = COLOR_VAL_GREEN;	break;
		case "violet":	PARTICLE_COLOR = COLOR_VAL_VIOLET;	break;
		case "blue":	PARTICLE_COLOR = COLOR_VAL_BLUE;	break;
		default:		PARTICLE_COLOR = COLOR_VAL_FIRE;	break;
	}
}

// trigger fire on/off
function fireOnOff(){
	fire = !fire;
	if(!fire)
		follow = true;
}

// reset the origin position to the center of the canvas
function resetPosition(){
	mousePosX = 300;
	mousePosY = 200;
}
