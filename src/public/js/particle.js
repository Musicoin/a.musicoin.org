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


/*	PARTICLE OBJECT
 *	This object defines a single particle that keeps track of its
 *	position, current color, alpha value, and when it "dies".
 *	The Particle System should stop updating a particle once it is
 *	dead (i.e. no longer visible)
 */

/* PARAMETERS:
 *	x, y is the initial starting position
 *	xVelocity, yVelocity should define the speed and direction
 *		of the particle's movement
 *	lifespan indicates the duration that this particle should
 *		live.
 */
function Particle(x, y, xVelocity, yVelocity, lifespan, color){
	// set initial position and velocity
	this.x = x;
	this.y = y;
	this.xVelocity = xVelocity;
	this.yVelocity = yVelocity;
	this.color = color;
	
	// set initial alpha to 1.0 (fully visibile)
	this.alpha = 1.0;
	// dAlpha is the amount that alpha changes per frame, randomly
	//	scaled around the provided particle lifespan
	this.dAlpha = 1/(Math.random()*lifespan + 0.001);
	
	// updates the particle's position by its velocity each frame,
	//	and adjust's the alpha value
	this.update = function(){
		this.x += this.xVelocity;
		this.y -= this.yVelocity;
		this.alpha -= this.dAlpha;
		if(this.alpha < 0)
			this.alpha = 0;
	}
	
	// returns the RGB string [ "rbg(r, g, b)" ] of the calculated color
	//	values of this particle
	this.getColor = function(){
		if(this.color == COLOR_VAL_FIRE){
			return	"rgb(255, " +
					Math.round(255*this.alpha) + ", " +
					Math.round((255*this.alpha*this.alpha*this.alpha))+ ")";
		}
		else if(this.color == COLOR_VAL_RED){
			return	"rgb(255, " +
					Math.round((255*this.alpha*this.alpha*this.alpha)) + ", " +
					Math.round((255*this.alpha*this.alpha*this.alpha))+ ")";
		}
		else if(this.color == COLOR_VAL_GREEN){
			return	"rgb(" + Math.round(255*this.alpha) +
					", 255, " +
					Math.round((255*this.alpha*this.alpha*this.alpha))+ ")";
		}
		else if(this.color == COLOR_VAL_VIOLET){
			return	"rgb(" + Math.round(255*this.alpha) + ", " +
					Math.round((255*this.alpha*this.alpha*this.alpha)) +
					", 255)";
		}
		else{ // COLOR_VAL_BLUE
			return	"rgb(" + Math.round((255*this.alpha*this.alpha*this.alpha))
					+ ", " + Math.round(255*this.alpha) +
					", 255)";
		}
	}
	
	// draw the particle to the screen
	this.draw = function(pCtx){
		pCtx.save();
			pCtx.fillStyle = this.getColor();
			pCtx.globalAlpha = this.alpha;
			pCtx.beginPath();
			pCtx.arc(this.x, this.y, PARTICLE_SIZE, 0, 2 * Math.PI, false);
			pCtx.closePath();
			pCtx.fill();
		pCtx.restore();
	}
	
	// returns TRUE if this particle is "dead":
	//	i.e. delete and stop updating it if this returns TRUE
	this.dead = function(){
		return this.alpha <= 0;
	}
}
