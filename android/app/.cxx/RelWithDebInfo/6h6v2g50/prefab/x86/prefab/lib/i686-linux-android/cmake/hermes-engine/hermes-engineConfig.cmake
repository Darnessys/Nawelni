if(NOT TARGET hermes-engine::libhermes)
add_library(hermes-engine::libhermes SHARED IMPORTED)
set_target_properties(hermes-engine::libhermes PROPERTIES
    IMPORTED_LOCATION "C:/Users/Darness/.gradle/caches/8.14.3/transforms/e0dd1161cdfd6f674c9b0917c0398251/transformed/hermes-android-0.81.5-release/prefab/modules/libhermes/libs/android.x86/libhermes.so"
    INTERFACE_INCLUDE_DIRECTORIES "C:/Users/Darness/.gradle/caches/8.14.3/transforms/e0dd1161cdfd6f674c9b0917c0398251/transformed/hermes-android-0.81.5-release/prefab/modules/libhermes/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

