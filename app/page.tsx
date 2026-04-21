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
      const res = await fetch(`http://${savedIp}/channel/${channelNumber}/${action}`, {
        method: "GET",
      })

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
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Remote Panel Testing Dashboard</h1>
          <p className="text-slate-400">
            User interface for Communication Hub and Panel Device control
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-5">
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-4">
              <p className="text-sm text-slate-400">UI Status</p>
              <p className="mt-2 text-xl font-semibold">{status}</p>
            </CardContent>
          </Card>

          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-4">
              <p className="text-sm text-slate-400">CH Status</p>
              <p className="mt-2 text-xl font-semibold">
                {telemetry.ch.online ? "Online" : "Offline"}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-4">
              <p className="text-sm text-slate-400">PD Status</p>
              <p className="mt-2 text-xl font-semibold">
                {telemetry.pd.online ? "Online" : "Offline"}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-4">
              <p className="text-sm text-slate-400">Active Channels</p>
              <p className="mt-2 text-xl font-semibold">{activeChannelCount}</p>
            </CardContent>
          </Card>

          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-4">
              <p className="text-sm text-slate-400">Last Update</p>
              <p className="mt-2 text-xl font-semibold">{lastUpdate}</p>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-4 space-y-4">
            <div>
              <h2 className="text-lg font-semibold">CH Endpoint</h2>
              <p className="text-sm text-slate-400">
                Enter the current IP address used by the UI to reach the
                communication hub.
              </p>
            </div>

            <div className="flex flex-col gap-3 md:flex-row">
              <Input
                value={esp32Ip}
                onChange={(e) => setEsp32Ip(e.target.value)}
                placeholder="e.g. 192.168.0.204"
                className="bg-slate-950 border-slate-700 text-white"
              />
              <Button onClick={saveDeviceIp}>Save</Button>
              <Button variant="outline" onClick={fetchTelemetry}>
                Refresh
              </Button>
              <Button variant="destructive" onClick={allOutputsOff}>
                All Outputs Off
              </Button>
            </div>

            <p className="text-sm text-slate-400">
              Connected CH: {telemetry.ch.endpoint || "None"}
            </p>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-4 space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Communication Hub</h2>
                <p className="text-sm text-slate-400">
                  Wireless bridge between the UI and the panel device
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-slate-400">Status</p>
                  <Badge variant={telemetry.ch.online ? "default" : "secondary"}>
                    {telemetry.ch.online ? "Online" : "Offline"}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-slate-400">Signal Strength</p>
                  <p className="font-medium">
                    {telemetry.ch.online
                      ? rssiToPercent(telemetry.ch.signalStrength)
                      : "0%"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-4 space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Panel Device</h2>
                <p className="text-sm text-slate-400">
                  Slave module controlling test channels inside the panel
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-slate-400">Status</p>
                  <Badge variant={telemetry.pd.online ? "default" : "secondary"}>
                    {telemetry.pd.online ? "Online" : "Offline"}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-slate-400">Protocol</p>
                  <p className="font-medium">{telemetry.pd.protocol}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-400">Fault</p>
                  <p className="font-medium">{telemetry.pd.fault ?? "None"}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-400">Voltage</p>
                  <p className="font-medium">
                    {telemetry.measurements.voltage === null
                      ? "No data"
                      : `${telemetry.measurements.voltage.toFixed(3)} V`}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-4 space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Panel Test Channels</h2>
              <p className="text-sm text-slate-400">
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
                    className="bg-slate-950 border-slate-800"
                  >
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold">
                            Channel {channel.number}
                          </p>
                          <p className="text-sm text-slate-400">
                            {channel.label}
                          </p>
                        </div>
                        <Badge
                          variant={
                            isFault
                              ? "destructive"
                              : isActive
                              ? "default"
                              : "secondary"
                          }
                        >
                          {isFault ? "Fault" : isActive ? "Active" : "Off"}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <p className="text-slate-400">Phase</p>
                          <p>{channel.phase}</p>
                        </div>
                        <div>
                          <p className="text-slate-400">GPIO</p>
                          <p>{channel.gpio}</p>
                        </div>
                        <div>
                          <p className="text-slate-400">Commanded</p>
                          <p>{channel.commandedState}</p>
                        </div>
                        <div>
                          <p className="text-slate-400">Actual</p>
                          <p>{channel.actualState}</p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-400">Output</span>
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
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-4 space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Voltage Trend</h2>
                <p className="text-sm text-slate-400">
                  Recent live voltage samples from the panel device
                </p>
              </div>

              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={voltageHistory}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="time" />
                    <YAxis domain={["auto", "auto"]} />
                    <Tooltip />
                    <Line
                      type="monotone"
                      dataKey="voltage"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-4 space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Event Log</h2>
                <p className="text-sm text-slate-400">
                  Recent UI actions and system updates
                </p>
              </div>

              <div className="space-y-3 max-h-72 overflow-y-auto">
                {eventLog.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-lg border border-slate-800 bg-slate-950 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">{entry.action}</p>
                      <span className="text-xs text-slate-500">
                        {entry.time}
                      </span>
                    </div>
                    <p className="text-sm text-slate-400">
                      {entry.source} → {entry.target}
                    </p>
                    <p className="text-sm">{entry.result}</p>
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