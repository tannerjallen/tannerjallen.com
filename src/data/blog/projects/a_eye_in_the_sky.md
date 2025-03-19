---
author: Tanner J. Allen
pubDatetime: 2022-09-23T15:22:00Z
modDatetime: 2025-03-08T07:46:00.619Z
title: A-Eye in the Sky
slug: a-eye-in-the-sky
featured: true
draft: false
tags:
  - docs
  - project
description: That time I spied on my dog.
---

## A **Big** Purchase—In Both Cost and Size

I recently hit a **major** life milestone: I bought a brand new couch! No more questionable, used couches for me. In addition to composing a significant portion of my children's inheritance, it also meant new changes for my dog, Rupert.

You see, Rupert is an **angel**—just look at him!

![Rupert Lounging](@/assets/images/dog_cam/lounging.jpg)
**<div style="text-align: center;">Rupert the Half-Human Dog Lounging on the Couch</div>**

But, he unfortunately **loves** sleeping on the couch...

![Rupert's Perfect Sleeping Posture](@/assets/images/dog_cam/sleeping.jpg)
**<div style="text-align: center;">Rupert's Superior Sleeping Posture</div>**

With the new couch came change, and I'm not talking about nickels. His couch-surfing days were numbered due his relentless shedding. Don't worry, he still has his own couch he can use however he wants in our office, but the new couch? Off-limits.

Rupert, being a smart cookie, quickly adjusted to the changes. We gave him his own comfy bed (Costco's finest, highly recommend) to console this abrupt change and make me feel less guilty for abruptly ending his free-reign couch tenure. All was going well. We had a hair-free, pristine couch.

At least, that's what I thought until my girlfriend realized he was couch-surfing while we were away 🫣. Unfortunately, his intelligence gets the best of him when not in our presence, and he learned he can do whatever he wants when unmonitored.

![Me At Work While Rupert Sleeps on the Couch](@/assets/images/dog_cam/window_meme.png)
**<div style="text-align: center;">Forever Jealous Dogs Don't Have to Work</div>**

## Houston, We Have a Problem...

I started with some makeshift barriers from around the house thinking that would stop him.

![Rupert Sneaking onto the Couch](@/assets/images/dog_cam/sneaky.gif)
**<div style="text-align: center;">Sneaky Dog...</div>**

Nope... So, I moved onto a more established barrier by erecting a gate to block off his access to the area with the couch altogether. That's when I learned just how much this dog wants to be on the couch.

![Rupert Jumping Over and Onto the Couch](@/assets/images/dog_cam/jumper.gif)
**<div style="text-align: center;">He's Got That Dog in Him</div>**

## Outsmarting the Pooch

Despite the attempts to prevent his unmonitored behavior, it became clear I needed to outsmart the dog. While Rupert is crate-trained, it always hurts my heart a little leaving him in there. So, I decided to put my engineering skills to use and develop an overly-complicated solution for a minor life inconvenience. Action!

### The Plan

I wanted to use a camera combined with some AI tools to monitor Rupert's activities and detect whether he is on the couch or not. If he is on the couch, I'd use an old training collar to administer a beep, letting him know someone is watching...

![Always Watching](@/assets/images/dog_cam/always_watching.gif)
**<div style="text-align: center;">Always Watching...</div>**

My final solution is available for use in my dog_cam Github repo:
[![tannerjallen/dog_cam - GitHub](@/assets/images/dog_cam/github.png)](https://github.com/tannerjallen/dog_cam)

### Getting Myself Off the Couch

My first idea was to use a Wi-Fi camera feed to keep an eye on Rupert's activities. However, our Ring camera didn't broadcast an easy-to-access feed to develop off of. Based on some research, I landed on using a Wyze Cam v3 to broadcast a Real-Time Streaming Protocol (RTSP) video feed. This was a little difficult. Wyze's current camera firmware does not support RTSP. This required backdating the cameras firmware to an older version that did support RTSP feeds. For more information on this, the following Wyze support articles discuss Wyze's RTSP support:

- [Does Wyze Cam v3 Support RTSP?](https://support.wyze.com/hc/en-us/articles/360051619871-Does-Wyze-Cam-v3-support-RTSP)
- [Wyze Cam RTSP](https://support.wyze.com/hc/en-us/articles/360026245231-Wyze-Cam-RTSP)

### Honey, Where is the Dog?

After setting up the RTSP video feed successfully, I processed the data to classify the couch and Rupert. I started with [Ultralytics YOLO11](https://github.com/ultralytics/ultralytics) real-time object detection model. This model consumes video data frame-by-fame and classifies known objects.

This model detects dog **and** couch objects, making it ideal for this use case. I started with having the model detect the couch.

I started with having it detect rupert and track his position. In addition to having it draw a rectangle boundary around him, I also wrote the script to detect his centroid. This seemed like a little more conservative way to represent his actual position. Here's the model following him around:

![YOLO11 Tracking Rupert](@/assets/images/dog_cam/dog_detect.gif)
**<div style="text-align: center;">We Found The Dog!</div>**

### Honey, Where is the Couch?

Now that I'm tracking my ~~son~~—I swear I'm not *that* type of dog owner. I transitioned to figuring out how to establish a boundary (a lesson I'm still trying to learn in all aspects of my life). YOLO11 successfully classified the couch and constructed a boundary around it right out of the box.

![YOLO11 Detecting the Couch](@/assets/images/dog_cam/couch_classification.png)
**<div style="text-align: center;">YOLO11 Model Detects Couch and Draws Boundary</div>**

The blue boundary the model draws was a little too liberal for this use case—I didn't want to detect when Rupert was lying on the floor near the couch or was walking behind it. I only wanted it to detect when he was actually **on** the couch, so I refined this to a tighter detection zone focused on the couch's seating surface. The red boundary is the danger zone Rupert is not allowed in.

### So, What Are You Gonna Do About It?

Now that I had a functioning way to detect Rupert's position and an imaginary no-no zone, I moved on to what action would be administered to thwart this canine couch-surfer. I found an old training collar (available [here](https://a.co/d/4xBPpxn)) and tore apart the transmitter.

The transmitter had three contact pads for each of the collar's functions: beep, vibrate, or shock.

Since I strongly question the ethics of allowing an object detection model to administer a shock to my pup without a human-in-the-loop, I focused on the beep function alone.

These pads transmit a command to the collar to perform the respective when shorted across each other. It's just a switch. On the back of the circuit board, there where contact pads to solder to. After soldering prototype wiring to each side of the beep switch, I moved onto the controls.

The wiring from the transmitter connects to the emitter and collector pins of an NPN transistor (2N2222). A Raspberry Pi 4 GPIO pin with a 1kOhm resistor in series connects to the transistor's gate. This allows me to control the training collar transmitter with the Raspberry Pi 4.

![Transmitter and Raspberry Pi Wiring](@/assets/images/dog_cam/transmitter_wiring.png)
**<div style="text-align: center;">Wiring Diagram </div>**

By setting the GPIO pin to high (or just ON in non-technical jargon), the transmitter commanded a beep from the training collar. I wrote up a little Python function to integrate all these systems together.

When Rupert's is detected in the couch's danger zone, the Raspberry Pi closes the transmitter's switch commanding a beep from the collar. I also implemented some logging to let me know each time the script requested a beep, so I could review the camera footage and confirm it was a legitimate request for validation.

## Did It Work?

After gaining complete confidence in the solution, I left Rupert alone for around 30 minutes   and sure enough...

![Successfully Deterring the Couch-Surfer](@/assets/images/dog_cam/success.gif)
**<div style="text-align: center;">It Worked!</div>**

Right as he thought about stepping onto the couch, the system administered a beep to let him know something's watching him.

**Fun fact**: He only attempted to get on the couch once that day. What can I say? My boy's a quick learner!

## Some Medium-Sized Hurdles Encountered

I know it sounds like this project was a total breeze, but it wasn't necessarily, and I love being transparent about my stupid moments. Here are a few hurdles I encountered:

- I started with a hardcoded couch boundary because I originally used a object detection model without a couch classification ability. After a few days of testing, I noticed the camera would move a little bit, and I also wanted a solution I could easily move somewhere else. It was clear that dynamically classifying the couch would be a huge asset to prevent any camera drift.
- The first camera position I used was straight-on from the couch a couple feet off the ground. I wasn't using a fancy depth camera or multiple cameras with advanced post-processing to infer a distance. So, if Rupert strolled between the camera and the couch, it would set a false alarm that he was on the couch when in reality he was just positioned in front of the couch. I relocated the camera to a higher vantage point to prevent any misfires from Rupert just walking between the camera and the couch boundary.
- A large requirement (from the girlfriend) was to have a very low-key solution. Let's play a game. Spot the dog monitoring camera:
  ![Spot the Camera](@/assets/images/dog_cam/camera.jpeg)
  **<div style="text-align: center;">I *Think* I Met the Low-Key Requirement</div>**

## Canine Camera: The Reunion

After using the solution for over a week now, Rupert has not made his way onto the couch at all! The logs report he has only attempted to get on the couch three times with absolutely no attempts the past few days.

![Great Success](@/assets/images/dog_cam/great_success.gif)
**<div style="text-align: center;">Big Win</div>**

The shelf the camera sits on has also encountered a few bumps from the Roomba shifting the camera's perspective a little bit. If I wasn't using an object detection model for couch classification, this would have required me to recalculate hardcoded couch boundary coordinates. I'm happy I went with the more advanced system that does this all for me and allows me to just move this camera wherever I want.

He may have lost the couch, but he's still living his best life.

![Crazy Rupert](@/assets/images/dog_cam/crazy_rupert.jpg)
**<div style="text-align: center;">Look At Those Chompers!</div>**
