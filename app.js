
"use strict";

const $ = (id) => document.getElementById(id);
const STORE = "logimind_shipments_v1";
const STOP_STORE = "logimind_stops_v1";

function load(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

let shipments = load(STORE);
let stops = load(STOP_STORE);

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(shipments));
    localStorage.setItem(STOP_STORE, JSON.stringify(stops));
    return true;
  } catch {
    $("formMessage").textContent =
      "Storage unavailable. Your changes may not persist.";
    return false;
  }
}

function safe(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  })[ch]);
}

function isDelayed(s) {
  return s.status !== "Delivered" &&
    (s.status === "Delayed" ||
     (s.eta && new Date(s.eta).getTime() < Date.now()));
}

function renderShipments() {
  $("total").textContent = shipments.length;
  $("transit").textContent =
    shipments.filter(s => s.status === "In Transit").length;
  $("delays").textContent = shipments.filter(isDelayed).length;

  const list = $("shipmentList");

  if (!shipments.length) {
    list.innerHTML =
      '<p class="hint">No shipments yet. Add your first shipment above.</p>';
    return;
  }

  list.innerHTML = shipments.map((s, i) => {
    const delayed = isDelayed(s);
    const statusClass = delayed ? "alert" :
      s.status === "Delivered" ? "good" : "";

    const eta = s.eta
      ? new Date(s.eta).toLocaleString()
      : "Not provided";

    return `
      <article class="shipment-card">
        <div class="card-head">
          <strong>${safe(s.id)}</strong>
          <span class="pill ${statusClass}">
            ${delayed ? "Delay risk" : safe(s.status)}
          </span>
        </div>
        <p>${safe(s.origin)} → ${safe(s.destination)}</p>
        <div class="muted">Expected delivery: ${safe(eta)}</div>
        ${delayed ? `
          <p class="muted">
            Delivery time has passed or the shipment is marked delayed.
            Verify its actual location and contact the carrier.
          </p>` : ""}
        <div class="card-actions">
          <button class="secondary" data-action="next" data-index="${i}">
            Update status
          </button>
          <button class="secondary" data-action="delete" data-index="${i}">
            Delete
          </button>
        </div>
      </article>`;
  }).join("");
}

$("shipmentForm").addEventListener("submit", event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const id = String(form.get("id")).trim();

  if (shipments.some(s => s.id.toLowerCase() === id.toLowerCase())) {
    $("formMessage").textContent = "That shipment ID already exists.";
    return;
  }

  const eta = String(form.get("eta"));
  if (!Number.isFinite(new Date(eta).getTime())) {
    $("formMessage").textContent = "Enter a valid delivery date.";
    return;
  }

  shipments.unshift({
    id,
    origin: String(form.get("origin")).trim(),
    destination: String(form.get("destination")).trim(),
    eta,
    status: String(form.get("status"))
  });

  save();
  renderShipments();
  event.currentTarget.reset();
  $("formMessage").textContent = "Shipment added.";
});

$("shipmentList").addEventListener("click", event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const i = Number(button.dataset.index);
  if (!shipments[i]) return;

  if (button.dataset.action === "delete") {
    shipments.splice(i, 1);
  } else {
    const states = ["Pending", "In Transit", "Delivered", "Delayed"];
    const current = states.indexOf(shipments[i].status);
    shipments[i].status = states[(current + 1) % states.length];
  }

  save();
  renderShipments();
});

$("refresh").addEventListener("click", renderShipments);

function renderStops() {
  $("stopList").innerHTML = stops.map((s, i) => `
    <div class="stop-card">
      <div>
        <strong>${safe(s.name)}</strong>
        <div class="muted">${s.lat}, ${s.lon}</div>
      </div>
      <button class="secondary" data-remove="${i}" aria-label="Remove stop">
        Remove
      </button>
    </div>
  `).join("");
}

$("stopForm").addEventListener("submit", event => {
  event.preventDefault();
  const f = new FormData(event.currentTarget);
  const name = String(f.get("name")).trim();
  const lat = Number(f.get("lat"));
  const lon = Number(f.get("lon"));

  if (!name || !Number.isFinite(lat) || !Number.isFinite(lon) ||
      lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return;
  }

  stops.push({ name, lat, lon });
  save();
  renderStops();
  $("routeResult").innerHTML = "";
  event.currentTarget.reset();
});

$("stopList").addEventListener("click", event => {
  const button = event.target.closest("button[data-remove]");
  if (!button) return;
  stops.splice(Number(button.dataset.remove), 1);
  save();
  renderStops();
  $("routeResult").innerHTML = "";
});

function distance(a, b) {
  const rad = d => d * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) *
    Math.sin(dLon / 2) ** 2;

  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, x)));
}

$("optimize").addEventListener("click", () => {
  if (stops.length < 2) {
    $("routeResult").textContent =
      "Add at least two delivery stops to plan a route.";
    return;
  }

  // Nearest-neighbor heuristic, starting at the first entered stop.
  const remaining = stops.slice(1);
  const route = [stops[0]];
  let totalKm = 0;

  while (remaining.length) {
    const last = route[route.length - 1];
    let best = 0;

    for (let i = 1; i < remaining.length; i++) {
      if (distance(last, remaining[i]) <
          distance(last, remaining[best])) {
        best = i;
      }
    }

    const next = remaining.splice(best, 1)[0];
    totalKm += distance(last, next);
    route.push(next);
  }

  $("routeResult").innerHTML = `
    <strong>Suggested stop order</strong>
    <ol>${route.map(s => `<li>${safe(s.name)}</li>`).join("")}</ol>
    <p>Approximate straight-line distance:
      <strong>${totalKm.toFixed(1)} km</strong>
    </p>
    <p class="muted">
      This is a heuristic using geographic coordinates, not road distance,
      live traffic, or a guaranteed optimal route.
    </p>`;
});

$("review").addEventListener("click", () => {
  const risks = shipments.filter(isDelayed);
  const result = $("riskResult");

  if (!shipments.length) {
    result.textContent = "Add shipment records to review delivery risks.";
    return;
  }

  if (!risks.length) {
    result.textContent =
      "No current delay alerts based on the recorded statuses and ETAs. " +
      "This does not confirm real-world delivery conditions.";
    return;
  }

  result.innerHTML = `
    <strong>${risks.length} shipment(s) need attention</strong>
    <ul>${risks.map(s => `
      <li>${safe(s.id)}: ${safe(s.origin)} to
      ${safe(s.destination)}. Verify carrier status, check for route
      disruptions, and notify the recipient if needed.</li>
    `).join("")}</ul>
    <p class="muted">Rule-based alerts only; AI is not connected yet.</p>`;
});

renderShipments();
renderStops();
                                        
