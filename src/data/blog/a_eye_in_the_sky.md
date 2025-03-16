---
author: Tanner J. Allen
pubDatetime: 2022-09-23T15:22:00Z
modDatetime: 2025-03-08T07:46:00.619Z
title: A-Eye in the Sky
slug: a-eye-in-the-sky
featured: true
draft: true
tags:
  - docs
  - project
description: Figuring things out.
---

My dog, Rupert, is an angel! Just look at him!


At least, that's what I thought until I (let's be honest, it was my girlfriend) realized he was couch-surfing when I was away 🫣. Unfortunately, his intelligence gets the best of him when not in my presence

- add link to remote
- take pics
- talk about the transistor and wiring
- include videos of him hopping over the couch, climbing around chairs, etc.

### Problems Encountered
- Originally used a statically coded boundary due to an earlier model, but the camera would shift, and I wanted something I could just move to a new location and not have to get too in the weeds with updating the points
- Wanted to keep the solution lowkey and hidden/not out of place
- Camera angling - head on shot would flag if he walked between the camera and couch which is allowed - opted to set it up with a higher view
- Couch boundaries were liberal, and technically he's fine standing next to the couch, just not on it, so I updated the boundary to dynamically only cover the top two thirds of the couch detection
- How to reverse engineer the transmitter I had

### So, How Did It Go?