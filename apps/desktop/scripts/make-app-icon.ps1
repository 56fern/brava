param(
  [string]$Source = (Join-Path $PSScriptRoot "..\src\renderer\src\assets\brava-logo-light.png"),
  [string]$PngDestination = (Join-Path $PSScriptRoot "..\build\icon-large-v3.png"),
  [string]$IcoDestination = (Join-Path $PSScriptRoot "..\build\icon-large-v3.ico")
)

Add-Type -AssemblyName System.Drawing

function New-ResizedPngBytes([System.Drawing.Image]$Image, [int]$Size) {
  $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $stream = [System.IO.MemoryStream]::new()
  try {
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.DrawImage($Image, 0, 0, $Size, $Size)
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    return ,$stream.ToArray()
  }
  finally {
    $stream.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

$sourcePath = [System.IO.Path]::GetFullPath($Source)
$pngPath = [System.IO.Path]::GetFullPath($PngDestination)
$icoPath = [System.IO.Path]::GetFullPath($IcoDestination)
$sourceImage = [System.Drawing.Image]::FromFile($sourcePath)

try {
  $pngBytes = New-ResizedPngBytes $sourceImage 512
  [System.IO.File]::WriteAllBytes($pngPath, $pngBytes)

  $sizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
  $images = @($sizes | ForEach-Object { New-ResizedPngBytes $sourceImage $_ })
  $stream = [System.IO.File]::Create($icoPath)
  $writer = [System.IO.BinaryWriter]::new($stream)
  try {
    $writer.Write([uint16]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]$sizes.Count)
    $offset = 6 + (16 * $sizes.Count)
    for ($index = 0; $index -lt $sizes.Count; $index++) {
      $size = $sizes[$index]
      $writer.Write([byte]$(if ($size -eq 256) { 0 } else { $size }))
      $writer.Write([byte]$(if ($size -eq 256) { 0 } else { $size }))
      $writer.Write([byte]0)
      $writer.Write([byte]0)
      $writer.Write([uint16]1)
      $writer.Write([uint16]32)
      $writer.Write([uint32]$images[$index].Length)
      $writer.Write([uint32]$offset)
      $offset += $images[$index].Length
    }
    foreach ($image in $images) { $writer.Write($image) }
  }
  finally {
    $writer.Dispose()
    $stream.Dispose()
  }
}
finally {
  $sourceImage.Dispose()
}
