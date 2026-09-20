# Compatibility shim: the package was renamed and its install script with it.
# Kept so an existing shortcut or note that points at the old filename still runs.
& (Join-Path $PSScriptRoot '安装.ps1') @args