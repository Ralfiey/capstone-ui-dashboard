"use client"

import { defaultSystemTelemetry } from "@/lib/default-system"
import type { ChannelState, CommandState, SystemTelemetry } from "@/lib/types"
import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

type ConnectionStatus = "Connected" | "Offline" | "Connecting"

type VoltageHistoryPoint = {
  time: string
  voltage: number
}

function mapChannelStateToLegacyStatus(
  channel: ChannelState
): "active" | "inactive" | "fault" {
  if (
    channel.commandedState === "fault" ||
    channel.actualState === "fault" ||
    channel.fault
  ) {
    return "fault"
  }

  if (channel.commandedState === "on" || channel.actualState === "on") {
    return "active"
  }

  return "inactive"
}

function getActiveChannelCount(channels: ChannelState[]) {
  return channels.filter(
    (channel) =>
      channel.commandedState === "on" || channel.actualState === "on"
  ).length
}

function rssiToPercent(rssi: number): string {
  if (rssi >= -50) return "100%"
  if (rssi <= -100) return "0%"
  return Math.round(((rssi + 100) / 50) * 100) + "%"
}

export default function HomePage() {
  const [esp32Ip, setEsp32Ip] = useState("")
  const [savedIp, setSavedIp] = useState("")
  const [status, setStatus] = useState<ConnectionStatus>("Offline")
  const [lastUpdate, setLastUpdate] = useState("Never")
  const [telemetry, setTelemetry] =
    useState<SystemTelemetry>(defaultSystemTelemetry)
  const [channels, setChannels] = useState<ChannelState[]>(
    defaultSystemTelemetry.pd.channels
  )
  const [voltageHistory, setVoltageHistory] = useState<VoltageHistoryPoint[]>(
    []
  )
  const [eventLog, setEventLog] = useState(defaultSystemTelemetry.eventLog)

  function addLog(
    source: string,
    target: string,
    action: string,
    result: string,
    notes?: string
  ) {
    setEventLog((prev) => [
      {
        id: `evt-${Date.now()}`,
        time: new Date().toLocaleTimeString(),
        source,
        target,
        action,
        result,
        notes,
      },
      ...prev.slice(0, 24),
    ])
  }

  function saveDeviceIp() {
    localStorage.setItem("esp32_ip", esp32Ip)
    setSavedIp(esp32Ip)
    addLog("UI", "CH Endpoint", "Save IP", `Saved ${esp32Ip}`)
  }

  async function fetchTelemetry() {
    if (!savedIp) return

    try {
      setStatus("Connecting")

      const res = await fetch(`http://${savedIp}/telemetry`, {
        method: "GET",
      })

      if (!res.ok) {
        throw new Error("Failed to fetch telemetry")
      }

      const json = await res.json()
      const now = new Date().toLocaleTimeString()

      setTelemetry((prev) => {
        const updatedChannels: ChannelState[] = prev.pd.channels.map(
          (channel) => {
            const channelKey = `channel${channel.number}`
            const fallbackRelayKey = `relay${channel.number}`

            const reportedState = Boolean(
              json[channelKey] ??
                json[fallbackRelayKey] ??
                (channel.actualState === "on")
            )

            const actualState: CommandState = reportedState ? "on" : "off"

            const channelFault =
              typeof json[`channel${channel.number}Fault`] === "string"
                ? json[`channel${channel.number}Fault`]
                : channel.fault

            return {
              ...channel,
              actualState,
              fault: channelFault,
              lastResponse: now,
            }
          }
        )

        setChannels(updatedChannels)

        return {
          ...prev,
          ui: {
            ...prev.ui,
            online: true,
            lastHeartbeat: now,
          },
          ch: {
            ...prev.ch,
            endpoint: savedIp,
            online: true,
            signalStrength: Number(
              json.signalStrength ?? prev.ch.signalStrength ?? 0
            ),
            lastHeartbeat: now,
          },
          pd: {
            ...prev.pd,
            online: Boolean(json.pdOnline ?? true),
            protocol:
              json.pdProtocol === "ESP-NOW" ||
              json.pdProtocol === "LoRa" ||
              json.pdProtocol === "Wi-Fi Bridge" ||
              json.pdProtocol === "Unknown"
                ? json.pdProtocol
                : prev.pd.protocol,
            lastHeartbeat: now,
            fault: json.pdFault ?? null,
            channels: updatedChannels,
            channelCount: updatedChannels.length,
          },
          measurements: {
            ...prev.measurements,
            voltage:
              json.voltage === undefined || json.voltage === null
                ? prev.measurements.voltage
                : Number(json.voltage),
            continuityStatus:
              json.continuityStatus ?? prev.measurements.continuityStatus,
            phaseDetected:
              json.phaseDetected ?? prev.measurements.phaseDetected,
            neutralGroundStatus:
              json.neutralGroundStatus ??
              prev.measurements.neutralGroundStatus,
            freshness: `Updated ${now}`,
          },
        }
      })

      if (json.voltage !== undefined && json.voltage !== null) {
        setVoltageHistory((prev) => [
          ...prev.slice(-19),
          {
            time: now,
            voltage: Number(json.voltage),
          },
        ])
      }

      setStatus("Connected")
      setLastUpdate(now)
    } catch (error) {
      console.log("ESP32 offline", error)
      setStatus("Offline")
      setTelemetry((prev) => ({
        ...prev,
        ui: {
          ...prev.ui,
          online: false,
        },
        ch: {
          ...prev.ch,
          endpoint: savedIp,
          online: false,
        },
        pd: {
          ...prev.pd,
          online: false,
        },
      }))
    }
  }

  async function toggleChannel(channelNumber: number, state: boolean) {
    if (state) {
      const confirmed = window.confirm(
        `Activate Channel ${channelNumber}? This will send a live command to the panel device.`
      )
      if (!confirmed) return
    }

    const action = state ? "on" : "off"
    const now = new Date().toLocaleTimeString()

    try {
      const res = await fetch(
        `http://${savedIp}/channel/${channelNumber}/${action}`,
        {
          method: "GET",
        }
      )

      if (!res.ok) {
        throw new Error(`Channel ${channelNumber} ${action} failed`)
      }

      setChannels((prev) =>
        prev.map((channel) => {
          if (channel.number !== channelNumber) return channel

          const nextState: CommandState = state ? "on" : "off"

          return {
            ...channel,
            commandedState: nextState,
            actualState: nextState,
            lastCommand: `${action.toUpperCase()} @ ${now}`,
            lastResponse: now,
          }
        })
      )

      addLog("UI", `PD Channel ${channelNumber}`, `Set ${action}`, "Success")
      fetchTelemetry()
    } catch (error) {
      console.log(`Failed to toggle channel ${channelNumber}`, error)
      setStatus("Offline")
      addLog("UI", `PD Channel ${channelNumber}`, `Set ${action}`, "Failed")
    }
  }

  async function allOutputsOff() {
    const now = new Date().toLocaleTimeString()

    const activeChannels = channels.filter(
      (channel) =>
        channel.commandedState === "on" || channel.actualState === "on"
    )

    for (const channel of activeChannels) {
      try {
        await fetch(`http://${savedIp}/channel/${channel.number}/off`, {
          method: "GET",
        })
      } catch (error) {
        console.log(`Failed to turn off channel ${channel.number}`, error)
      }
    }

    setChannels((prev) =>
      prev.map((channel) => ({
        ...channel,
        commandedState: "off",
        actualState: "off",
        lastCommand: `OFF @ ${now}`,
        lastResponse: now,
      }))
    )

    addLog("UI", "All Channels", "Emergency Off", "Completed")
    fetchTelemetry()
  }

  useEffect(() => {
    const storedIp = localStorage.getItem("esp32_ip")
    if (storedIp) {
      setEsp32Ip(storedIp)
      setSavedIp(storedIp)
    }
  }, [])

  useEffect(() => {
    setTelemetry((prev) => ({
      ...prev,
      eventLog,
      ch: {
        ...prev.ch,
        endpoint: savedIp,
      },
      pd: {
        ...prev.pd,
        channels,
        channelCount: channels.length,
      },
    }))
  }, [channels, eventLog, savedIp])

  useEffect(() => {
    fetchTelemetry()
    const interval = setInterval(fetchTelemetry, 2000)
    return () => clearInterval(interval)
  }, [savedIp])

  const activeChannelCount = getActiveChannelCount(channels)

  return (
    <div className="min-h-screen bg-white text-black p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-black">
            Remote Panel Testing Dashboard
          </h1>
          <p className="text-slate-600">
            User interface for Communication Hub and Panel Device control
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-5">
          <Card className="bg-white border-slate-200 text-black">
            <CardContent className="p-4">
              <p className="text-sm text-slate-500">UI Status</p>
              <p className="mt-2 text-xl font-semibold text-black">{status}</p>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200 text-black">
            <CardContent className="p-4">
              <p className="text-sm text-slate-500">CH Status</p>
              <p className="mt-2 text-xl font-semibold text-black">
                {telemetry.ch.online ? "Online" : "Offline"}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200 text-black">
            <CardContent className="p-4">
              <p className="text-sm text-slate-500">PD Status</p>
              <p className="mt-2 text-xl font-semibold text-black">
                {telemetry.pd.online ? "Online" : "Offline"}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200 text-black">
            <CardContent className="p-4">
              <p className="text-sm text-slate-500">Active Channels</p>
              <p className="mt-2 text-xl font-semibold text-black">
                {activeChannelCount}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200 text-black">
            <CardContent className="p-4">
              <p className="text-sm text-slate-500">Last Update</p>
              <p className="mt-2 text-xl font-semibold text-black">
                {lastUpdate}
              </p>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-white border-slate-200 text-black">
          <CardContent className="p-4 space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-black">CH Endpoint</h2>
              <p className="text-sm text-slate-600">
                Enter the current IP address used by the UI to reach the
                communication hub.
              </p>
            </div>

            <div className="flex flex-col gap-3 md:flex-row">
              <Input
                value={esp32Ip}
                onChange={(e) => setEsp32Ip(e.target.value)}
                placeholder="e.g. 192.168.0.204"
                className="bg-white border-slate-300 text-black placeholder:text-slate-400"
              />
              <Button onClick={saveDeviceIp}>Save</Button>
              <Button variant="outline" onClick={fetchTelemetry}>
                Refresh
              </Button>
              <Button variant="destructive" onClick={allOutputsOff}>
                All Outputs Off
              </Button>
            </div>

            <p className="text-sm text-slate-600">
              Connected CH: {telemetry.ch.endpoint || "None"}
            </p>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="bg-white border-slate-200 text-black">
            <CardContent className="p-4 space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-black">
                  Communication Hub
                </h2>
                <p className="text-sm text-slate-600">
                  Wireless bridge between the UI and the panel device
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-slate-500">Status</p>
                  <Badge
                    className={
                      telemetry.ch.online
                        ? "bg-green-600 text-white hover:bg-green-600"
                        : "bg-slate-200 text-black hover:bg-slate-200"
                    }
                  >
                    {telemetry.ch.online ? "Online" : "Offline"}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-slate-500">Signal Strength</p>
                  <p className="font-medium text-black">
                    {telemetry.ch.online
                      ? rssiToPercent(telemetry.ch.signalStrength)
                      : "0%"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200 text-black">
            <CardContent className="p-4 space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-black">
                  Panel Device
                </h2>
                <p className="text-sm text-slate-600">
                  Slave module controlling test channels inside the panel
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-slate-500">Status</p>
                  <Badge
                    className={
                      telemetry.pd.online
                        ? "bg-green-600 text-white hover:bg-green-600"
                        : "bg-slate-200 text-black hover:bg-slate-200"
                    }
                  >
                    {telemetry.pd.online ? "Online" : "Offline"}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-slate-500">Protocol</p>
                  <p className="font-medium text-black">
                    {telemetry.pd.protocol}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-white border-slate-200 text-black">
          <CardContent className="p-4 space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-black">
                Panel Test Channels
              </h2>
              <p className="text-sm text-slate-600">
                Remote control and status for each PD output channel
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {channels.map((channel) => {
                const legacyStatus = mapChannelStateToLegacyStatus(channel)
                const isActive = legacyStatus === "active"
                const isFault = legacyStatus === "fault"

                return (
                  <Card
                    key={channel.number}
                    className="bg-slate-50 border-slate-200 text-black"
                  >
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-black">
                            Channel {channel.number}
                          </p>
                          <p className="text-sm text-slate-600">
                            {channel.label}
                          </p>
                        </div>
                        <Badge
                          className={
                            isFault
                              ? "bg-red-600 text-white hover:bg-red-600"
                              : isActive
                              ? "bg-green-600 text-white hover:bg-green-600"
                              : "bg-slate-200 text-black hover:bg-slate-200"
                          }
                        >
                          {isFault ? "Fault" : isActive ? "Active" : "Off"}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <p className="text-slate-500">Phase</p>
                          <p className="text-black">{channel.phase}</p>
                        </div>
                        <div>
                          <p className="text-slate-500">GPIO</p>
                          <p className="text-black">{channel.gpio}</p>
                        </div>
                        <div>
                          <p className="text-slate-500">Commanded</p>
                          <p className="text-black">{channel.commandedState}</p>
                        </div>
                        <div>
                          <p className="text-slate-500">Actual</p>
                          <p className="text-black">{channel.actualState}</p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-500">Output</span>
                        <Switch
                          checked={channel.actualState === "on"}
                          onCheckedChange={(checked) =>
                            toggleChannel(channel.number, checked)
                          }
                        />
                      </div>

                      <div className="text-xs text-slate-500 space-y-1">
                        <p>Last command: {channel.lastCommand}</p>
                        <p>Last response: {channel.lastResponse}</p>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="bg-white border-slate-200 text-black">
            <CardContent className="p-4 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-black">
                    Voltage RMS
                  </h2>
                  <p className="text-sm text-slate-600">
                    Recent live voltage samples from the panel device
                  </p>
                </div>

                <div className="text-right">
                  <p className="text-sm text-slate-500">Current Voltage</p>
                  <p className="text-3xl font-bold text-black">
                    {telemetry.measurements.voltage === null
                      ? "No data"
                      : `${telemetry.measurements.voltage.toFixed(3)} V`}
                  </p>
                </div>
              </div>

              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={voltageHistory}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="time" stroke="#475569" />
                    <YAxis
                      domain={[0, "auto"]}
                      stroke="#475569"
                      padding={{ top: 20, bottom: 10 }}
                    />
                    <Tooltip
  formatter={(value: number | string | undefined) => [
    `${Number(value ?? 0).toFixed(3)} V`,
    "Voltage",
  ]}
  contentStyle={{
    backgroundColor: "#ffffff",
    border: "1px solid #cbd5e1",
    color: "#000000",
  }}
  labelStyle={{ color: "#000000" }}
/>
                    <Line
                      type="monotone"
                      dataKey="voltage"
                      stroke="#2563eb"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200 text-black">
            <CardContent className="p-4 space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-black">Event Log</h2>
                <p className="text-sm text-slate-600">
                  Recent UI actions and system updates
                </p>
              </div>

              <div className="space-y-3 max-h-72 overflow-y-auto">
                {eventLog.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-black"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-black">{entry.action}</p>
                      <span className="text-xs text-slate-500">
                        {entry.time}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600">
                      {entry.source} → {entry.target}
                    </p>
                    <p className="text-sm text-black">{entry.result}</p>
                    {entry.notes ? (
                      <p className="text-xs text-slate-500">{entry.notes}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
