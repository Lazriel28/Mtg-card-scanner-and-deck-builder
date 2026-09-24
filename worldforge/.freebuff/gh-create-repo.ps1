# Creates Lazriel28/WorldForge via the GitHub REST API.
# Run elevated if the calling process cannot reach the GitHub API.
param(
    [Parameter()]
    [string]$Token
)

$body = @{
    name             = 'WorldForge'
    full_name        = 'Lazriel28/WorldForge'
    description      = 'Offline worldbuilding, book and cinema studio for Obsidian vaults. Free replacement for paid wiki/world tools.'
    homepage         = 'https://github.com/Lazriel28/WorldForge'
    private          = $false
    has_issues       = $true
    has_projects     = $false
    has_wiki         = $false
    has_downloads    = $true
    default_branch   = 'main'
    auto_init        = $true
    gitignore_template = 'Electron'
} | ConvertTo-Json -Compress

$headers = @{
    Authorization    = 'Bearer ' + $Token
    Accept           = 'application/vnd.github+json'
    'X-GitHub-Api-Version' = '2022-11-28'
    'Content-Type'   = 'application/json'
}

$resp = Invoke-RestMethod -Method Post `
    -Uri 'https://api.github.com/user/repos' `
    -Headers $headers `
    -Body $body

Write-Output 'HTTP=201'
Write-Output ('clone_url={0}' -f $resp.clone_url)
Write-Output ('html_url={0}' -f $resp.html_url)
Write-Output ('default_branch={0}' -f $resp.default_branch)
Write-Output ('owner={0}' -f $resp.owner.login)
