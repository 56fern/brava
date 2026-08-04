param(
  [string]$Source = (Join-Path $PSScriptRoot "..\src\renderer\src\assets\brava-logo-v2.png"),
  [string]$Destination = (Join-Path $PSScriptRoot "..\src\renderer\src\assets\brava-logo-light.png")
)

Add-Type -AssemblyName System.Drawing
$sourcePath = [System.IO.Path]::GetFullPath($Source)
$destinationPath = [System.IO.Path]::GetFullPath($Destination)
$sourceBitmap = [System.Drawing.Bitmap]::new($sourcePath)
$outputBitmap = [System.Drawing.Bitmap]::new($sourceBitmap.Width, $sourceBitmap.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)

try {
  for ($y = 0; $y -lt $sourceBitmap.Height; $y++) {
    for ($x = 0; $x -lt $sourceBitmap.Width; $x++) {
      $pixel = $sourceBitmap.GetPixel($x, $y)
      $maximum = [Math]::Max($pixel.R, [Math]::Max($pixel.G, $pixel.B))
      $minimum = [Math]::Min($pixel.R, [Math]::Min($pixel.G, $pixel.B))
      $isNeutralBlade = $pixel.A -gt 0 -and ($maximum - $minimum) -lt 55 -and $maximum -gt 55
      if ($isNeutralBlade) {
        $shade = [Math]::Min(31, [Math]::Max(12, [int](12 + ($maximum / 255) * 19)))
        $pixel = [System.Drawing.Color]::FromArgb($pixel.A, $shade, [Math]::Min(255, $shade + 3), [Math]::Min(255, $shade + 7))
      }
      $outputBitmap.SetPixel($x, $y, $pixel)
    }
  }
  $outputBitmap.Save($destinationPath, [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
  $outputBitmap.Dispose()
  $sourceBitmap.Dispose()
}
