## What this shows

A quick look at the **sf** sample dataset, published from ouRGeo.

``` r
library(sf)
nc <- st_read(system.file("shape/nc.shp", package = "sf"), quiet = TRUE)
head(nc[, c("NAME", "AREA", "BIR74")], 3)
```

    ## Simple feature collection with 3 features and 3 fields
    ## Geometry type: MULTIPOLYGON
    ## Dimension:     XY
    ## Bounding box:  xmin: -81.74107 ymin: 36.23388 xmax: -80.43531 ymax: 36.58965
    ## Geodetic CRS:  NAD27
    ##        NAME  AREA BIR74                       geometry
    ## 1      Ashe 0.114  1091 MULTIPOLYGON (((-81.47276 3...
    ## 2 Alleghany 0.061   487 MULTIPOLYGON (((-81.23989 3...
    ## 3     Surry 0.143  3188 MULTIPOLYGON (((-80.45634 3...

| NAME      | BIR74 | geometry                     |
|:----------|------:|:-----------------------------|
| Ashe      |  1091 | MULTIPOLYGON (((-81.47276 3… |
| Alleghany |   487 | MULTIPOLYGON (((-81.23989 3… |
| Surry     |  3188 | MULTIPOLYGON (((-80.45634 3… |

``` r
plot(nc["AREA"], main = "Area by county")
```

![](/home/datauser/.config/ourgeo/publish-preview/publish-me_files/figure-markdown_strict/plot-1.png)

Done.
