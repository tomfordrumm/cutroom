import { useQueryClient } from "@tanstack/react-query"
import { Scissors } from "lucide-react"
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { post } from "@/lib/api"

export default function LoginPage() {
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      await post("/api/login", { password })
      await queryClient.invalidateQueries()
      navigate("/")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-svh place-items-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <span className="mb-2 grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Scissors className="size-5" />
          </span>
          <CardTitle className="text-xl">Cutroom</CardTitle>
          <CardDescription>Пароль владельца из файла .env на сервере.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-3">
            <Input type="password" placeholder="Пароль" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <Button type="submit" disabled={busy}>Войти</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
