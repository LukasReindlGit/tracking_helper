# Tracking Helper

## Run locally

This app uses browser ES modules, so you cannot open `index.html` as a `file://` URL—the scripts will not load. Serve the project folder over HTTP instead.

From the repository root (`tracking_helper`):

```bash
python3 -m http.server 8080
```

Then open [http://localhost:8080/](http://localhost:8080/) in your browser. Use any free port if `8080` is taken (e.g. `python3 -m http.server 3000` and open `http://localhost:3000/`).

---

Lightweight, client-side time tracking for daily work topics—designed to reduce end-of-day recall effort and to make manual entry into external systems (e.g. Salesforce) fast and consistent.

## Overview

The problem is familiar: logging hours at the end of the day is tedious and inaccurate when you must reconstruct what you did and for how long. This project is a small web app that behaves like a **stopwatch**: you work against named topics (often ticket identifiers), accumulate time, and get totals that are easy to copy elsewhere.

**Design goals**

- **No mandatory backend**: prefer browser storage (e.g. cookies or equivalent) so a database is not required for a first version.
- **EU/Germany**: include **cookie consent** before using non-essential storage or tracking mechanisms.
- **Salesforce-aligned UX**: visual language inspired by Salesforce so the tool feels consistent with the system where numbers are ultimately entered—without automating SF integration.
- **Flexible topics**: simple add/remove of what you track.
- **Reporting visuals**: pie charts for the day—“recorded vs 8 h” (including remainder when under 8 h) and a **scaled** view that stretches proportional rows to the **target day total** you choose (slider, default 8 h). When your recorded total is **above** that target, the app does **not** scale down: it shows **actual** hours per topic in the second chart and copy table. **Total recorded today** appears in the Charts section whenever there is data.

**Deployment intent**

Host as a subpath of a personal site (e.g. `lukas-reindl.de/tracking`).

## rough idea

I need to track my hours every day at the end of the work day. 
That is quite annoying because it is hard to remember what i did and for how long.

i want to have a little webapp that helps me keep track of the topics i work on. 
maybe it can work by just using cookies and not needing a DB of any sort.

since i am in germany, i need a cookie consent page.

maybe something like jira stopwatch.

at the end, i need to track my hours in SF and there is no way i can connect to it automatically. so it should be easy to copy the ticket number and time. time can be in the format 5.3 (in hours).

it should be easy to add a topic to track or remove one. 

I think it makes sense to add it as a subpage like lukas-reindl.de/tracking.

would be cool to have a graphical representation of the tracked hours in a pie chart.
one pie chart with the hours in relation to 8h total (so including the rest to fill up 8h work day)
and a "scaled" version, which increases all hours to make them fill up 8h of a day. 
example would be: 3h Tick-101 and 2h Tick-103 -> 3h rest -> scaled becomes:  60% => 4.8h for Tick-101 and 40% => 3.2h Tick-103.

styling should look like salesforce. 

## Non-goals (initially)

- Direct API integration with Salesforce or other ticketing systems.
- Multi-user accounts or server-side persistence (unless added later by choice).

## Success criteria

- Fast daily use with minimal friction at end of day.
- One-click or low-friction **copy** of ticket identifier + **decimal hours** (e.g. `5.3`).
- Clear charts: raw day composition vs 8 h, plus scaled breakdown to a chosen target; total recorded hours visible; no scale-down when recorded time exceeds that target.
- Consent-gated storage for German/EU visitors.

## Change requests

time trackings should be one list of rows. 
each row: input label for the ticket name, input field for tracked time, stopwatch start and pause buttons. the stopwatch updates the tracked time in the input field.