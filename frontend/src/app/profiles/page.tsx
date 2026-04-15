"use client";

import { useEffect, useState } from "react";
import {
  fetchDrivers,
  createDriver,
  fetchVehicles,
  createVehicle,
  type Driver,
  type Vehicle,
} from "@/lib/api";

export default function ProfilesPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [driverName, setDriverName] = useState("");
  const [driverWeight, setDriverWeight] = useState(0);
  const [vehicleName, setVehicleName] = useState("");
  const [vehicleClass, setVehicleClass] = useState("");
  const [vehicleEngine, setVehicleEngine] = useState("");

  function refresh() {
    fetchDrivers().then(setDrivers).catch(() => setDrivers([]));
    fetchVehicles().then(setVehicles).catch(() => setVehicles([]));
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleAddDriver(e: React.FormEvent) {
    e.preventDefault();
    if (!driverName.trim()) return;
    await createDriver(driverName.trim(), driverWeight);
    setDriverName("");
    setDriverWeight(0);
    refresh();
  }

  async function handleAddVehicle(e: React.FormEvent) {
    e.preventDefault();
    if (!vehicleName.trim()) return;
    await createVehicle(vehicleName.trim(), vehicleClass, vehicleEngine);
    setVehicleName("");
    setVehicleClass("");
    setVehicleEngine("");
    refresh();
  }

  return (
    <div className="p-6 space-y-6 text-sm">
      <h1 className="text-lg font-semibold">Drivers &amp; vehicles</h1>

      <section className="space-y-2">
        <h2 className="font-semibold">Drivers</h2>
        <form onSubmit={handleAddDriver} className="flex gap-2">
          <input
            className="bg-muted rounded px-2 py-1"
            placeholder="Name"
            value={driverName}
            onChange={(e) => setDriverName(e.target.value)}
          />
          <input
            type="number"
            className="bg-muted rounded px-2 py-1 w-24"
            placeholder="Weight (kg)"
            value={driverWeight || ""}
            onChange={(e) => setDriverWeight(Number(e.target.value) || 0)}
          />
          <button className="bg-primary text-primary-foreground rounded px-3 py-1">Add</button>
        </form>
        <ul className="space-y-1">
          {drivers.map((d) => (
            <li key={d.id} className="rounded bg-muted px-2 py-1">
              <b>{d.name}</b> · {d.weight_kg} kg
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Vehicles</h2>
        <form onSubmit={handleAddVehicle} className="flex gap-2">
          <input
            className="bg-muted rounded px-2 py-1"
            placeholder="Name"
            value={vehicleName}
            onChange={(e) => setVehicleName(e.target.value)}
          />
          <input
            className="bg-muted rounded px-2 py-1"
            placeholder="Class"
            value={vehicleClass}
            onChange={(e) => setVehicleClass(e.target.value)}
          />
          <input
            className="bg-muted rounded px-2 py-1"
            placeholder="Engine"
            value={vehicleEngine}
            onChange={(e) => setVehicleEngine(e.target.value)}
          />
          <button className="bg-primary text-primary-foreground rounded px-3 py-1">Add</button>
        </form>
        <ul className="space-y-1">
          {vehicles.map((v) => (
            <li key={v.id} className="rounded bg-muted px-2 py-1">
              <b>{v.name}</b> · {v.class || "—"} · {v.engine || "—"}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
