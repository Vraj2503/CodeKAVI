// main.go — Go entry point for the sample fixture repo.
//
// Tests Go import extraction (single and grouped imports).

package main

import (
	"fmt"
	"os"
)

func main() {
	name := "World"
	if len(os.Args) > 1 {
		name = os.Args[1]
	}
	fmt.Printf("Hello, %s!\n", name)
}
