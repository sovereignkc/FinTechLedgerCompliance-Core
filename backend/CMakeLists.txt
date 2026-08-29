cmake_minimum_required(VERSION 3.16)

project(FinTechLedgerModernization LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(SQLite3 REQUIRED)
find_package(Threads REQUIRED)

add_executable(ledger_api ledger_api.cpp)

target_link_libraries(
    ledger_api
    PRIVATE
        SQLite::SQLite3
        Threads::Threads
)

target_compile_options(
    ledger_api
    PRIVATE
        -Wall
        -Wextra
        -Wpedantic
)
