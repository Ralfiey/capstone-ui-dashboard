"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts"

type Telemetry = {
  voltage: number
  current: number
  power: number
  relay1: boolean
  relay2: boolean
}

type ConnectionStatus = "Connected" | "Offline" | "Connecting"

export default function Page() {
  const [esp32Ip, setEsp32Ip] = useState("192.168.0.204")
  const [savedIp, setSavedIp] = useState("192.168.0.204")

  const [data, setData] = useState<Telemetry>({
    voltage: 0,
    current: 0,
    power: 0,
    relay1: false,
    relay2: false,
  })

  const [status, setStatus] = useState<ConnectionStatus>("Connecting")
  const [lastUpdate, setLastUpdate] = useState<string>("Never")

  const [voltageHistory, setVoltageHistory] = useState<
    { time: string; voltage: number }[]
  >([])

  async function fetchTelemetry() {
    try {
      setStatus("Connecting")

      const res = await fetch(`http://${savedIp}/telemetry`, {
        method: "GET",
      })

      if (!res.ok) {
        throw new Error("Failed to fetch telemetry")
      }

      const json = await res.json()

      setData({
        voltage: json.voltage,
        current: json.current,
        power: json.power,
        relay1: json.relay1,
        relay2: json.relay2,
      })

      setVoltageHistory((prev) => [
        ...prev.slice(-19),
        {
          time: new Date().toLocaleTimeString(),
          voltage: json.voltage,
        },
      ])

      setStatus("Connected")
      setLastUpdate(new Date().toLocaleTimeString())
    } catch (error) {
      console.log("ESP32 offline", error)
      setStatus("Offline")
    }
  }

  async function toggleRelay(relay: number, state: boolean) {
    const action = state ? "on" : "off"

    try {
      await fetch(`http://${savedIp}/relay${relay}/${action}`, {
        method: "GET",
      })

      fetchTelemetry()
    } catch (error) {
      console.log(`Failed to toggle relay ${relay}`, error)
      setStatus("Offline")
    }
  }

  function saveDeviceIp() {
    setSavedIp(esp32Ip)
    setVoltageHistory([])
    setLastUpdate("Never")
    setStatus("Connecting")
  }

  useEffect(() => {
    fetchTelemetry()

    const interval = setInterval(fetchTelemetry, 2000)

    return () => clearInterval(interval)
  }, [savedIp])

  return (
    <main className="min-h-screen bg-background p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              ESP32 Power Monitor Dashboard
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Responsive web dashboard for ESP32 control and telemetry.
            </p>
          </div>

          <Card className="w-full max-w-md rounded-2xl">
            <CardContent className="space-y-4 p-5">
              <div>
                <p className="text-sm font-medium">Device IP</p>
                <p className="text-xs text-muted-foreground">
                  Enter the current ESP32 IP address, then save it.
                </p>
              </div>

              <div className="flex gap-2">
                <Input
                  value={esp32Ip}
                  onChange={(e) => setEsp32Ip(e.target.value)}
                  placeholder="192.168.0.204"
                />
                <Button onClick={saveDeviceIp}>Save</Button>
              </div>

              <div className="text-sm text-muted-foreground">
                Active device: <span className="font-medium text-foreground">{savedIp}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card className="rounded-2xl">
            <CardContent className="space-y-2 p-6">
              <p className="text-sm text-muted-foreground">Connection Status</p>
              <Badge
                variant={
                  status === "Connected"
                    ? "default"
                    : status === "Offline"
                    ? "destructive"
                    : "secondary"
                }
              >
                {status}
              </Badge>
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardContent className="space-y-2 p-6">
              <p className="text-sm text-muted-foreground">Last Update</p>
              <p className="text-xl font-semibold">{lastUpdate}</p>
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardContent className="space-y-2 p-6">
              <p className="text-sm text-muted-foreground">Device IP in Use</p>
              <p className="text-xl font-semibold">{savedIp}</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card className="rounded-2xl">
            <CardContent className="p-6">
              <p className="text-sm text-muted-foreground">Voltage RMS</p>
              <p className="mt-2 text-3xl font-semibold">
                {data.voltage} <span className="text-lg font-normal">V</span>
              </p>
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardContent className="p-6">
              <p className="text-sm text-muted-foreground">Current RMS</p>
              <p className="mt-2 text-3xl font-semibold">
                {data.current} <span className="text-lg font-normal">A</span>
              </p>
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardContent className="p-6">
              <p className="text-sm text-muted-foreground">Power</p>
              <p className="mt-2 text-3xl font-semibold">
                {data.power} <span className="text-lg font-normal">W</span>
              </p>
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-2xl">
          <CardContent className="p-6">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-xl font-semibold">Relay Controls</h2>
                <p className="text-sm text-muted-foreground">
                  These switches send commands to the ESP32 using the saved device IP.
                </p>
              </div>

              <Button variant="outline" onClick={fetchTelemetry}>
                Refresh Now
              </Button>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="flex items-center justify-between rounded-xl border p-4">
                <div>
                  <p className="font-medium">Relay 1</p>
                  <p className="text-sm text-muted-foreground">Primary output control</p>
                </div>
                <Switch
                  checked={data.relay1}
                  onCheckedChange={(value) => toggleRelay(1, value)}
                  disabled={status === "Offline"}
                />
              </div>

              <div className="flex items-center justify-between rounded-xl border p-4">
                <div>
                  <p className="font-medium">Relay 2</p>
                  <p className="text-sm text-muted-foreground">Secondary output control</p>
                </div>
                <Switch
                  checked={data.relay2}
                  onCheckedChange={(value) => toggleRelay(2, value)}
                  disabled={status === "Offline"}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardContent className="p-6">
            <h2 className="text-xl font-semibold">Voltage Trend</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Displays recent voltage readings from the active ESP32.
            </p>

            <div className="mt-6 h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={voltageHistory}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="time" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="voltage" strokeWidth={2} dot />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardContent className="p-6">
            <h2 className="text-xl font-semibold">Current Telemetry Object</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Live JSON object currently being used by the dashboard.
            </p>

            <pre className="mt-4 overflow-x-auto rounded-xl border bg-muted p-4 text-sm">
{JSON.stringify(
  {
    deviceIp: savedIp,
    status,
    lastUpdate,
    ...data,
  },
  null,
  2
)}
            </pre>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}