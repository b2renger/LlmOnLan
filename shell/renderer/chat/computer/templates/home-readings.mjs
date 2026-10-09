// @ts-check
// Saved Home readings (docs/HOME_ASSISTANT.md, 2026-10-09): what a Home box hands on when no Home Assistant is linked,
// so lessons 13–14, the three home templates and the Home box's example all walk without a home. DATA, the shape
// src/main/homeAssistant.ts `read` returns. The ids are what a design-school studio on a Home Assistant Green would
// plausibly have: a temperature/humidity/CO2 sensor (AirGradient or Aqara-like), a power-measuring plug, a ceiling
// light, the weather Home Assistant makes at onboarding (met.no, `weather.forecast_home`) and a local calendar. A
// person's own home has other ids: Choose… on the box picks them.

const AT = '2026-10-09T08:00:00+00:00';

const temperature = { id: 'sensor.studio_temperature', name: 'Studio temperature', state: '23.8', value: 23.8, unit: '°C', attributes: { state_class: 'measurement', device_class: 'temperature' }, last_changed: '2026-10-09T07:52:10+00:00' };
const humidity = { id: 'sensor.studio_humidity', name: 'Studio humidity', state: '41', value: 41, unit: '%', attributes: { state_class: 'measurement', device_class: 'humidity' }, last_changed: '2026-10-09T07:40:02+00:00' };
const co2 = { id: 'sensor.studio_co2', name: 'Studio CO2', state: '1180', value: 1180, unit: 'ppm', attributes: { state_class: 'measurement', device_class: 'carbon_dioxide' }, last_changed: '2026-10-09T07:58:31+00:00' };

/** Lesson 13 and the Comfort advisor: the room now. */
export const STUDIO = { home: 'Studio', at: AT, devices: [temperature, humidity, co2], missing: [] };

/** The Morning briefing: the weather and its forecast, today's calendar, the room. */
export const MORNING = {
  home: 'Studio',
  at: '2026-10-09T06:45:00+00:00',
  devices: [
    {
      id: 'weather.forecast_home', name: 'Forecast Home', state: 'partlycloudy',
      attributes: { temperature: 11.2, temperature_unit: '°C', humidity: 82, wind_speed: 14.4, wind_speed_unit: 'km/h', precipitation_unit: 'mm', attribution: 'Weather forecast from met.no, delivered by the Norwegian Meteorological Institute.' },
      last_changed: '2026-10-09T06:30:00+00:00',
      forecast: [
        { datetime: '2026-10-09T10:00:00+00:00', condition: 'partlycloudy', temperature: 17.4, templow: 9.8, precipitation: 0.2, wind_speed: 16.2, humidity: 70 },
        { datetime: '2026-10-10T10:00:00+00:00', condition: 'rainy', temperature: 14.1, templow: 10.3, precipitation: 6.4, wind_speed: 24.5, humidity: 88 },
        { datetime: '2026-10-11T10:00:00+00:00', condition: 'cloudy', temperature: 15.0, templow: 8.7, precipitation: 0.0, wind_speed: 11.0, humidity: 76 },
      ],
    },
    {
      id: 'calendar.studio', name: 'Studio', state: 'off',
      attributes: { message: 'Crit — 2nd-year typography', all_day: false, start_time: '2026-10-09 10:00:00', end_time: '2026-10-09 12:00:00', location: 'Room B12' },
      last_changed: '2026-10-08T16:00:00+00:00',
      events: [
        { summary: 'Crit — 2nd-year typography', start: '2026-10-09T10:00:00+02:00', end: '2026-10-09T12:00:00+02:00', location: 'Room B12' },
        { summary: 'Lunch talk: a smart studio, kept local', start: '2026-10-09T12:30:00+02:00', end: '2026-10-09T13:15:00+02:00', location: 'Studio' },
        { summary: 'Laser cutter booked (Inès)', start: '2026-10-09T15:00:00+02:00', end: '2026-10-09T17:00:00+02:00' },
      ],
    },
    { ...temperature, state: '19.6', value: 19.6, last_changed: '2026-10-09T06:40:00+00:00' },
    { ...co2, state: '640', value: 640, last_changed: '2026-10-09T06:41:00+00:00' },
  ],
  missing: [],
};

/** The power a plug measured every 15 minutes over 24 hours: a laser cutter's quiet night and busy day. PURE. */
function day() {
  const start = Date.parse('2026-10-08T08:00:00+00:00');
  /** @type {{at: string, value: number}[]} */ const out = [];
  for (let i = 0; i < 96; i++) {
    const at = new Date(start + i * 15 * 60_000);
    const h = (at.getUTCHours() + 2) % 24 + at.getUTCMinutes() / 60;   // the studio's local time (UTC+2)
    let w = 6 + 2 * Math.sin(i * 1.7);                                  // standby
    if (h >= 9 && h < 18.5) w = 140 + 60 * Math.sin(i * 0.9);           // in use
    if ((h >= 10 && h < 11.5) || (h >= 15 && h < 17)) w = 420 + 50 * Math.sin(i * 2.3);   // cutting jobs
    if (h >= 12.5 && h < 13.5) w = 18 + 4 * Math.sin(i);                // lunch
    out.push({ at: at.toISOString().replace('.000Z', '+00:00'), value: Math.round(w * 10) / 10 });
  }
  return out;
}

/** The Energy report: one plug's power over the last 24 hours. */
export const POWER = {
  home: 'Studio',
  at: '2026-10-09T08:00:00+00:00',
  devices: [
    {
      id: 'sensor.laser_cutter_plug_power', name: 'Laser cutter plug power', state: '7.1', value: 7.1, unit: 'W',
      attributes: { state_class: 'measurement', device_class: 'power' }, last_changed: '2026-10-09T07:45:00+00:00',
      history: day(),
    },
  ],
  missing: [],
};
